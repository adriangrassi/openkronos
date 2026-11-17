import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { BankInfo } from "../../core/pcg/library.ts";
import { parseSmf, parseSmfChannels, type SmfChannelFacts } from "../../core/midi/smf.ts";
import { analyzeMidi, type MidiAnalysis } from "../../core/midi/analysis.ts";
import { MidiInfo } from "./MidiInfo.tsx";
import { allStopMessages, auditionEvents, GM_ON, gmSelectBytes, modeBytes, MidiPlayer, seqModeBytes, selectBytes, testPattern, withoutBankSelect, type PlayClock, type PlayEvent } from "../../core/midi/player.ts";
import { assignByName, suggestWord } from "../../core/midi/assign.ts";
import { gmInstrument, matchSong, searchPrograms, suggestSound, suggestSounds, type Match, type SoundIndex } from "../../core/midi/match.ts";
import { describeError, type Link } from "./keyboard.ts";
import { Collapse } from "./Collapse.tsx";
import { MidiBrowser } from "./MidiBrowser.tsx";
import { SongFinder } from "./SongFinder.tsx";
import { MidiRecorderPanel } from "./MidiRecorderPanel.tsx";
import { MidiMatch } from "./MidiMatch.tsx";
import { soundLabel } from "./midimatch.ts";
import { applyLevels, DEFAULT_LEVEL, levelBytes, parseLevels } from "../../core/midi/levels.ts";
import { MidiTransport, type TransportChannel, type TransportState } from "./MidiTransport.tsx";
import type { SongFacts, SongPick } from "../../core/ai/song.ts";

interface MidiPanelProps {
  link: Link | null;
  locked: boolean;
  info: BankInfo | null;
  sel: number[];
  soundIdx: SoundIndex | null;
  // Selects a slot in the bank list (App's openBank plus setSel).
  onPick: (key: string, index: number) => void;
  onError: (msg: string | null) => void;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
  // The loaded file's facts, for the AI panel; null when none is loaded.
  onSong: (song: SongFacts | null) => void;
  // Lets the AI panel assign sounds to tracks through the same path as a Use button.
  assignRef: MutableRefObject<((picks: SongPick[]) => void) | null>;
}

interface Target {
  key: string;
  kind: "program" | "combi";
  index: number;
}

const USE_KEY = "kronos.midimatch.use";
const TRACKS_STATUS = "Each track plays the General MIDI instrument the file asks for, or your replacement, in Sequencer mode.";
const TRACKS_TITLE = "Resets the tracks of the song open in the Kronos's Sequencer mode, in memory only.";
// A match at or above this score may switch the sound by itself; a lower one (a lone-word 0.7) is only shown.
const CONFIDENT = 0.9;

// shortcut: the clock is the browser's; the player only needs now and timers, so tests use their own clock
const clock: PlayClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

interface LoadedFile {
  id: number;
  name: string;
  events: PlayEvent[];
  channels: TransportChannel[];
  facts: SmfChannelFacts[]; // track name and first program per channel, for matching sounds
  durationMs: number;
  analysis: MidiAnalysis;
}

let nextFileId = 1;
const SELECT_LEAD_MS = 300;
// shortcut: a guess at how long the Kronos needs for each setup step, until timed on the real keyboard
const SEQ_STEP_MS = 800;
const GM_OK_KEY = "kronos.midi.gmInit";
const GM_WARNING = "Each track mode resets the tracks of the song open in the Kronos's Sequencer mode, in memory. Save that song on the Kronos first if it matters.";
const CHANNELS = Array.from({ length: 16 }, (_, i) => String(i + 1));
const ALL_CHANNELS = Array.from({ length: 16 }, (_, c) => c);
type Picks = Record<number, Match>; // track channel (0..15) -> the sound the user picked for it


export function MidiPanel({ link, locked, info, sel, soundIdx, onPick, onError, ask, onSong, assignRef }: MidiPanelProps) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const fileRef = useRef<LoadedFile | null>(null); // the latest file, for callbacks that outlive a render
  // "keyboard" plays every note on the selected sound. "file" keeps the song's own channels and instruments. "auto" is "file" for a multi-channel file, else "keyboard".
  const [chan, setChan] = useState("keyboard");
  const [picks, setPicks] = useState<Picks>({});
  const picksRef = useRef<Picks>({}); // mirrors picks, so a restart in the same tick sees the new pick
  const [levels, setLevels] = useState<Record<number, number>>({}); // owner-set channel volumes, non-default only, for the loaded file
  const levelsRef = useRef<Record<number, number>>({});
  const timers = useRef<number[]>([]); // setup steps and a delayed start, cancelled by Stop
  const clearLater = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const [ts, setTs] = useState<TransportState>({ tempo: 100, transpose: 0, loop: false, muted: [], solo: [] });
  const [pos, setPos] = useState(0);
  const [live, setLive] = useState(false); // the file (not the test pattern) is playing
  const posRef = useRef(0);
  const leadRef = useRef(0); // ms the current run added in front of the song
  useEffect(() => { void window.kronos.settingsGet().then((s) => setChan(s.channelMode)); }, []); // default channel mode from Settings
  // Channel every player message is sent on, or null to keep each message's own channel. The player sees the file's own channels, so mute, solo and drums work on them.
  const outRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [useSong, setUseSongState] = useState(() => localStorage.getItem(USE_KEY) !== "0");
  // The match Play used, for the status line.
  const [usedSong, setUsedSong] = useState<Match | null>(null);
  const [assignWord, setAssignWord] = useState(""); // session only, never saved
  const [assignMsg, setAssignMsg] = useState("");
  const lastKind = useRef<string | null>(null);
  const lastCall = useRef<string | null>(null); // "key/index/channel" last called up, so a click on it is not sent twice
  const liveRef = useRef(false);
  const queuedRef = useRef(false); // true only while the playlist started the current song
  const endRef = useRef<(() => void) | null>(null); // the playlist song-ended hook
  // A new link means a new player, so the old one's held notes are silenced on the old port.
  const player = useMemo(
    () =>
      link
        ? new MidiPlayer((m) => {
            const to = outRef.current;
            if (to === null || m[0] >= 0xf0) return link.send(m);
            const out = Uint8Array.from(m);
            out[0] = (m[0] & 0xf0) | to;
            link.send(out);
          }, clock)
        : null,
    [link],
  );

  const song = useMemo(() => (file && soundIdx ? matchSong(file.name, soundIdx)[0] ?? null : null), [file, soundIdx]);
  const channels = useMemo(
    () =>
      file?.facts.filter((c) => c.notes > 0).map((c) => ({
        channel: c.channel,
        trackName: c.trackName,
        sound: picks[c.channel] ?? (chan === "tracks" || !soundIdx ? null : suggestSound(c, soundIdx)),
        picked: picks[c.channel] !== undefined,
        gm: chan === "tracks" && !picks[c.channel] ? (c.channel === 9 ? "Drums" : gmInstrument(c.program ?? 0).name) : null,
      })) ?? null,
    [file, soundIdx, picks, chan],
  );

  useEffect(() => {
    setPlaying(false);
    const silence = () => {
      clearLater();
      player?.stop();
    };
    window.addEventListener("pagehide", silence);
    return () => {
      window.removeEventListener("pagehide", silence);
      silence();
    };
  }, [player]);

  // The mode a run plays in.
  // "tracks" needs a file: with a test pattern it plays as "keyboard".
  const modeFor = (f: LoadedFile | null): string => {
    if (chan === "tracks") return f ? "tracks" : "keyboard";
    return chan === "auto" ? (f && f.channels.length > 1 ? "file" : "keyboard") : chan;
  };
  // "keyboard" uses the keyboard's channel, "file" and "tracks" keep each event's own channel (null), a number is 1..16.
  const channelFor = (mode: string): number | null => {
    if (mode === "file" || mode === "tracks") return null;
    if (mode === "keyboard") return link?.channel ?? 0;
    return Number(mode) - 1;
  };
  // The channel a chosen sound is called up on: the keyboard's, or the number picked.
  const soundChannel = (): number => {
    const n = Number(chan);
    return Number.isNaN(n) ? link?.channel ?? 0 : n - 1;
  };

  // Channels of the file that are silent: all but the soloed ones if any, else the muted ones. These are the file's own channels, whatever the output channel.
  const mutedList = ts.solo.length ? ALL_CHANNELS.filter((c) => !ts.solo.includes(c)) : ts.muted;
  const mutedKey = mutedList.join();
  useEffect(() => {
    player?.setMuted(mutedList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, mutedKey]);
  useEffect(() => {
    player?.setTempo(ts.tempo / 100);
    player?.setTranspose(ts.transpose);
    player?.setLoop(ts.loop);
  }, [player, ts.tempo, ts.transpose, ts.loop]);

  const canPlay = !!link && !locked;
  const canSelect = canPlay && !!info && (info.kind === "program" || info.kind === "combi") && sel.length === 1;
  const selTarget: Target | null = canSelect && info && (info.kind === "program" || info.kind === "combi") ? { key: info.key, kind: info.kind, index: sel[0] } : null;

  // Mode Change (unless the mode is already right), then Bank Select and Program Change, on one channel.
  function callUp(t: Target, ch: number, keepMode: boolean) {
    if (!link) return;
    try {
      if (!keepMode) link.send(modeBytes(t.kind, ch));
      lastKind.current = t.kind;
      lastCall.current = `${t.key}/${t.index}/${ch}`;
      for (const b of selectBytes(t.key, t.index, ch)) link.send(b);
    } catch (e) {
      onError(describeError(e));
    }
  }

  // Sends a message list in order; a failure is shown and stops the list.
  function sendAll(msgs: Uint8Array[]) {
    if (!link) return;
    try {
      for (const m of msgs) link.send(m);
    } catch (e) {
      onError(describeError(e));
    }
  }

  // Only a confident match (score 0.9 or more) is played by itself; a lone-word suggestion is shown, never played.
  function confidentSong(name: string): Match | null {
    if (!soundIdx) return null;
    const m = matchSong(name, soundIdx)[0];
    return m && m.score >= CONFIDENT ? m : null;
  }

  // Starts the file (f) or the test pattern. The matching sound is chosen here and only here: a seek, a tempo change or a mute goes to the player and never calls up a sound.
  // modeArg overrides the channel menu for this run (a pick made while a song plays).
  function run(events: PlayEvent[], f: LoadedFile | null = null, queued = false, modeArg?: string) {
    const fromFile = !!f;
    queuedRef.current = queued;
    if (!player) return;
    const mode = modeArg ?? modeFor(f);
    const tracks = mode === "tracks" && !!f;
    if (tracks && localStorage.getItem(GM_OK_KEY) !== "1") {
      ask(GM_WARNING, "Continue", () => {
        localStorage.setItem(GM_OK_KEY, "1");
        run(events, f, queued, modeArg);
      });
      return;
    }
    clearLater();
    // "file" keeps the song's own instruments. Otherwise everything plays on the chosen sound.
    const audition = mode !== "file" && !tracks;
    const match = audition && f && useSong ? confidentSong(f.name) : null;
    const target: Target | null = match ? { key: match.key, kind: match.kind, index: match.index } : audition ? selTarget : null;
    if (match) onPick(match.key, match.index);
    player.stop(); // before the output channel changes, so held notes end where they began
    outRef.current = channelFor(mode);
    if (target) callUp(target, soundChannel(), lastKind.current === target.kind);
    let list = audition ? auditionEvents(events) : events;
    const lead = target ? SELECT_LEAD_MS : 0;
    let settle = target && fromFile ? SELECT_LEAD_MS : 0; // a real wait: the file's start position skips the lead
    if (tracks && f) {
      // Sequencer mode, GM System On to set the tracks up, then each track's sound: your pick, else the file's own General MIDI instrument.
      sendAll([seqModeBytes(link?.channel ?? 0)]);
      later(SEQ_STEP_MS, () => sendAll([GM_ON]));
      later(SEQ_STEP_MS * 2, () =>
        sendAll([
          ...f.facts.filter((c) => c.notes > 0).flatMap((c) => {
            const p = picksRef.current[c.channel];
            return p ? selectBytes(p.key, p.index, c.channel) : gmSelectBytes(c.channel, c.program ?? 0);
          }),
          ...Object.entries(levelsRef.current).map(([ch, v]) => levelBytes(Number(ch), v)),
        ]),
      );
      settle = SEQ_STEP_MS * 3;
      list = applyLevels(withoutBankSelect(auditionEvents(events, new Set(Object.keys(picksRef.current).map(Number)))), levelsRef.current);
      lastKind.current = "seq";
      lastCall.current = null;
    }
    // shortcut: 300 ms for the keyboard to load the sound, a guess until timed on the real Kronos
    leadRef.current = lead;
    const dur = f?.durationMs ?? 0;
    const start = posRef.current >= dur ? 0 : posRef.current;
    liveRef.current = fromFile;
    const begin = () => player.play(list.map((e) => ({ ...e, ms: e.ms + lead })), {
      channel: null,
      onEnd: () => {
        setPlaying(false);
        if (liveRef.current) seekTo(dur, false);
        liveRef.current = false;
        setLive(false);
        if (fromFile && queuedRef.current && endRef.current) {
          player.stop(); // a file may end with a note still held
          endRef.current();
        }
      },
      startMs: fromFile ? start + lead : 0,
      tempo: ts.tempo / 100,
      transpose: ts.transpose,
      muted: f ? mutedList : [], // mute and solo belong to the file, not the test pattern
      loop: ts.loop && !queued, // a looping song never ends, so the queue could not advance
    });
    if (settle > 0) later(settle, begin);
    else begin();
    setLive(fromFile);
    setPlaying(true);
    setUsedSong(match);
  }

  // While something plays, clicking another sound calls it up. A Mode Change can cut notes, so it is only sent when the mode differs.
  const selection = selTarget ? `${selTarget.key}/${selTarget.index}` : null;
  useEffect(() => {
    if (usedSong && selection !== `${usedSong.key}/${usedSong.index}`) setUsedSong(null);
    if (playing && selTarget && chan !== "tracks" && lastCall.current !== `${selection}/${soundChannel()}`) callUp(selTarget, soundChannel(), lastKind.current === selTarget.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  function stopPlayer() {
    clearLater();
    player?.stop();
    if (liveRef.current && player) seekTo(Math.max(0, player.positionMs() - leadRef.current), false);
    liveRef.current = false;
    setPlaying(false);
    setLive(false);
  }

  function seekTo(ms: number, move = true) {
    const to = Math.min(fileRef.current?.durationMs ?? 0, Math.max(0, ms));
    posRef.current = to;
    setPos(to);
    if (move && liveRef.current) player?.seek(to + leadRef.current);
  }

  function allStop() {
    clearLater();
    stopPlayer();
    if (link) for (const m of allStopMessages()) link.send(m);
  }

  // A track's sound picked from its list. It is stored and sent at once while a file plays; otherwise it waits for Play.
  // Back to the file's own instrument; heard at once if the song is playing track by track.
  function revertTrack(channel: number) {
    const next = { ...picksRef.current };
    delete next[channel];
    picksRef.current = next;
    setPicks(next);
    const facts = file?.facts.find((c) => c.channel === channel);
    if (playing && facts && modeFor(file) === "tracks") sendAll(gmSelectBytes(channel, facts.program ?? 0));
  }

  function pickSound(channel: number, m: Match) {
    assignPicks([{ channel, m }]);
  }

  function assignPicks(list: { channel: number; m: Match }[]) {
    const next = { ...picksRef.current };
    for (const { channel, m } of list) next[channel] = m;
    picksRef.current = next;
    setPicks(next);
    const wasTracks = chan === "tracks";
    setChan("tracks");
    if (!live || !file) return;
    if (wasTracks) sendAll(list.flatMap(({ channel, m }) => selectBytes(m.key, m.index, channel)));
    else run(file.events, file, false, "tracks");
  }

  // The AI panel's picks: a Program the index does not know cannot be shown as a sound, so it is skipped.
  useEffect(() => {
    assignRef.current = (picks) =>
      assignPicks(picks.flatMap((p) => {
        const ref = soundIdx?.entries.find((e) => e.ref.key === p.key && e.ref.index === p.index)?.ref;
        return ref ? [{ channel: p.channel, m: { ...ref, score: 1 } }] : [];
      }));
  });

  // Gives each track the sound whose name has the word, by the same assign path as the AI panel. Auto runs say nothing when no track matches.
  function assignNamed(word: string, auto = false) {
    if (!file || !soundIdx) return;
    const r = assignByName(file.facts, soundIdx.entries, word);
    if (auto && !r.picks.length) return;
    assignRef.current?.(r.picks.map(({ channel, key, index }) => ({ channel, key, index })));
    const m = file.facts.filter((c) => c.notes > 0).length;
    const list = (xs: string[]) => (xs.length > 8 ? `${xs.slice(0, 8).join(", ")}, +${xs.length - 8} more` : xs.join(", "));
    const picks = r.picks.length ? `: ${list(r.picks.map((p) => `ch ${p.channel + 1} ${p.name}`))}` : "";
    const left = r.unmatched.length ? ` Left alone: ${list(r.unmatched.map((c) => `ch ${c + 1}`))}` : "";
    if (!auto) setAssignMsg(`Assigned ${r.picks.length} of ${m} tracks${picks}${left}`);
    else setAssignMsg(`Auto-assigned ${r.picks.length} of ${m} tracks using sounds named "${word[0].toUpperCase()}${word.slice(1)}"${picks}${left}. Change a track with its search box, or Revert.`);
  }

  // A file whose name carries a word that names its sounds gets them once per file name, without typing.
  const autoFor = useRef<string | null>(null);
  useEffect(() => {
    if (!file || !soundIdx || autoFor.current === file.name) return;
    autoFor.current = file.name;
    const suggested = suggestWord(file.name, soundIdx.entries);
    if (!suggested || Object.keys(picksRef.current).length) return;
    setAssignWord(suggested.word);
    assignNamed(suggested.word, true);
  }, [file, soundIdx]);

  // Makes the bytes the current file. A bad file gives an error and the previous file stays loaded.
  function loadBytes(name: string, bytes: Uint8Array): LoadedFile | null {
    try {
      const smf = parseSmf(bytes);
      // shortcut: the file is parsed twice (the channel facts need the programs), fine for a few hundred KB, upgrade if a file ever shows lag
      const facts = parseSmfChannels(bytes);
      const analysis = analyzeMidi(bytes);
      stopPlayer();
      posRef.current = 0;
      setPos(0);
      const loaded = { id: nextFileId++, name, events: smf.events, channels: smf.channels, facts, durationMs: Math.round(smf.durationMs), analysis };
      fileRef.current = loaded;
      setFile(loaded);
      onSong(loaded);
      setTs((t) => ({ ...t, muted: [], solo: [] }));
      levelsRef.current = parseLevels(localStorage.getItem(`kronos.levels.${name}`));
      setLevels(levelsRef.current);
      picksRef.current = {};
      setPicks({});
      setUsedSong(null);
      setAssignMsg("");
      onError(null);
      return loaded;
    } catch (e) {
      onError(describeError(e));
      return null;
    }
  }

  async function openFile() {
    let opened: Awaited<ReturnType<typeof window.kronos.midiOpen>>;
    try {
      opened = await window.kronos.midiOpen();
    } catch (e) {
      onError(describeError(e));
      return;
    }
    if (opened) loadBytes(opened.name, opened.bytes);
  }

  // Play from the MIDI browser: the same path as the Play button.
  // Returns false when nothing started (bad file, no keyboard), so the playlist can skip it.
  function playBytes(name: string, bytes: Uint8Array): boolean {
    const loaded = loadBytes(name, bytes);
    if (!loaded || !canPlay || !player) return false;
    setTs((t) => ({ ...t, loop: false }));
    run(loaded.events, loaded, true);
    return true;
  }

  // A level slider: live CC7 on its channel when the keyboard is up, and remembered per file name.
  function setLevel(channel: number, value: number) {
    const v = Math.round(value);
    const next = { ...levelsRef.current };
    if (v === DEFAULT_LEVEL) delete next[channel];
    else next[channel] = v;
    levelsRef.current = next;
    setLevels(next);
    if (file) localStorage.setItem(`kronos.levels.${file.name}`, JSON.stringify(next));
    sendAll([levelBytes(channel, v)]);
  }

  // Every track back to the default level, sent to the keyboard at once.
  function resetLevels() {
    if (!file) return;
    levelsRef.current = {};
    setLevels({});
    localStorage.setItem(`kronos.levels.${file.name}`, "{}");
    sendAll(file.facts.filter((c) => c.notes > 0).map((c) => levelBytes(c.channel, DEFAULT_LEVEL)));
  }

  // A channel's Use button: select its sound in the list and call it up on that channel.
  function useChannel(channel: number, m: Match) {
    if (modeFor(file) === "tracks") return pickSound(channel, m); // calling it up in Program mode would end per-track playback
    onPick(m.key, m.index);
    callUp({ key: m.key, kind: m.kind, index: m.index }, channel, lastKind.current === m.kind);
  }

  function setUseSong(on: boolean) {
    setUseSongState(on);
    localStorage.setItem(USE_KEY, on ? "1" : "0");
  }

  return (
    <Collapse title="MIDI Player" label="MIDI player" className="keyboard">
      <SongFinder onLoad={loadBytes} />
      <div className="buttons">
        <button data-testid="midi-select-sound" onClick={() => selTarget && callUp(selTarget, soundChannel(), false)} disabled={!canSelect}>Select On Keyboard</button>
      </div>
      <p className="status" title="Play uses the selected sound, which replaces any unsaved edit in the keyboard's own edit buffer. Choose &quot;each track&quot; in the channel menu to give every track its own sound.">Plays through the selected sound.</p>
      <div className="buttons">
        <button data-testid="midi-test" onClick={() => run(testPattern())} disabled={!canPlay}>Play Test Pattern</button>
      </div>
      <div className="buttons">
        <button data-testid="midi-open" onClick={openFile} disabled={!canPlay}>MIDI File...</button>
        <span data-testid="midi-file-name" className="muted">{file?.name ?? "No file"}</span>
      </div>
      {file && (
        <div className="buttons">
          <input data-testid="assign-word" placeholder="Sounds named (e.g. Prayer)" aria-label="Sounds named" value={assignWord} onChange={(e) => setAssignWord(e.target.value)} />
          <button data-testid="assign-named" onClick={() => assignNamed(assignWord)} disabled={!assignWord.trim()}>Assign from my sounds</button>
        </div>
      )}
      {assignMsg && <p className="status">{assignMsg}</p>}
      <MidiMatch
        song={song}
        useSong={useSong}
        onUseSong={setUseSong}
        status={chan === "tracks" && file ? TRACKS_STATUS : usedSong ? `Playing ${soundLabel(usedSong)}, the song match.` : ""}
        statusTitle={chan === "tracks" && file ? TRACKS_TITLE : undefined}
        channels={channels}
        canPlay={canPlay}
        onUse={useChannel}
        onRevert={revertTrack}
        onSearch={(q) => (soundIdx ? searchPrograms(q, soundIdx) : [])}
        onBest={(ch) => {
          const c = file?.facts.find((f) => f.channel === ch);
          return c && soundIdx ? suggestSounds({ channel: ch, trackName: c.trackName, program: c.program }, soundIdx) : [];
        }}
        onAssign={pickSound}
      />
      <div className="buttons">
        <button data-testid="midi-play" onClick={() => file && run(file.events, file)} disabled={!canPlay || !file}>Play</button>
        <button data-testid="midi-stop" onClick={stopPlayer}>Stop</button>
        <button data-testid="midi-all-stop" onClick={allStop} disabled={!link}>All Stop</button>
        <select data-testid="midi-channel" aria-label="MIDI channel" value={chan} onChange={(e) => setChan(e.target.value)} disabled={!canPlay}>
          <option value="keyboard">keyboard</option>
          <option value="file">file</option>
          <option value="auto">auto</option>
          <option value="tracks">each track</option>
          {CHANNELS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      {file && (
        <MidiTransport
          key={file.id}
          events={file.events}
          channels={file.channels}
          durationMs={file.durationMs}
          pos={pos}
          live={live}
          getMs={() => Math.min(file.durationMs, Math.max(0, (player?.positionMs() ?? 0) - leadRef.current))}
          onTick={(ms) => { posRef.current = ms; setPos(ms); }}
          onSeek={(ms) => seekTo(ms)}
          state={ts}
          onChange={(patch) => setTs((t) => ({ ...t, ...patch }))}
          levels={chan === "tracks" ? { values: levels, onLevel: setLevel, onReset: resetLevels } : undefined}
        />
      )}
      {file && <MidiInfo a={file.analysis} posMs={pos} live={live} />}
      <MidiRecorderPanel link={link} canPlay={canPlay} onError={onError} />
      <div className="buttons">
        <button data-testid="midi-browse" aria-expanded={browsing} onClick={() => setBrowsing((b) => !b)}>
          {browsing ? "Close MIDI Browser" : "MIDI Browser..."}
        </button>
      </div>
      {browsing && <MidiBrowser canPlay={canPlay} onPlay={playBytes} onStop={stopPlayer} endRef={endRef} onError={onError} ask={ask} soundIdx={soundIdx} onPick={onPick} />}
    </Collapse>
  );
}
