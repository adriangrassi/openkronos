// Live editing: the open Program or Combi goes to the keyboard's edit buffer after each edit. Nothing is stored on the keyboard.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEntry } from "../../core/pcg/library.ts";
import { modeBytes, selectBytes } from "../../core/midi/player.ts";
import { Latest } from "../../core/device/live.ts";
import { LiveSender } from "../../core/device/livesend.ts";
import { readCurrentBytes } from "../../core/device/sync.ts";
import { checkText, compareEditBuffer, soundName } from "../../core/device/verify.ts";
import type { LiveKind } from "../../core/device/paramSend.ts";
import type { ParamTables } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import { describeError, type Link } from "./keyboard.ts";
import { useThemeA } from "./theme-a/useTheme.ts";

// shortcut: guesses for the Kronos's program load time until timed on the real keyboard; raise if the first send still gets overwritten
const SETTLE_MS = 600;
const RESEND_MS = 500;
const ON_KEY = "kronos.live.on";
const CONFIRMED_KEY = "kronos.live.confirmed";
const WARNING = "Live replaces the Kronos's edit buffer with this sound. Any unsaved edit made on the keyboard is lost. Nothing is stored on the keyboard. Turn Live on?";

interface Props {
  ws: Workspace;
  link: Link | null;
  tables: ParamTables | null;
  slotKey: string;
  index: number;
  rev: number; // App's edit counter: bumps after every edit, undo included
  locked: boolean;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
  onError: (msg: string | null) => void;
  onVerify: (strip: { ok: boolean; text: string } | null) => void;
  verifyHost?: HTMLElement | null; // where Check keyboard is drawn (step 5 of the Keyboard panel); in place when null
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

export function LiveEdit({ ws, link, tables, slotKey, index, rev, locked: lockedProp, ask, onError, onVerify, verifyHost = null }: Props) {
  // Style A keeps Check keyboard in the editor's action row; the other themes put it in step 5 of the Keyboard panel.
  const themeA = useThemeA();
  // A slot with pending AI changes is not sent to the keyboard until Keep or Discard.
  const locked = lockedProp || ws.isHeld(slotKey, index);
  const kind = ws.info(slotKey).kind === "combi" ? "combi" : "program";
  const [on, setOn] = useState(() => localStorage.getItem(ON_KEY) !== "0");
  const onRef = useRef(on);
  onRef.current = on;
  const callToken = useRef(0); // a newer call-up cancels the pending sends of an older one
  const lastSent = useRef<Uint8Array | null>(null); // the slot's bytes as last sent, to skip edits that changed nothing here
  // Settings > "Live edit: send single parameters" (default off); the dialog announces a change with a window event.
  const [single, setSingle] = useState(false);
  const singleRef = useRef(false);
  const [verify, setVerify] = useState(false);
  const verifyRef = useRef(false);
  verifyRef.current = verify;
  const [checking, setChecking] = useState(false);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  singleRef.current = single;
  useEffect(() => {
    void window.kronos.settingsGet().then((s) => {
      setSingle(s.liveParams);
      setVerify(s.verifyLive);
    });
    const onSettings = (e: Event) => {
      const d = (e as CustomEvent<{ liveParams: boolean; verifyLive: boolean }>).detail;
      setSingle(d.liveParams);
      setVerify(d.verifyLive);
    };
    window.addEventListener("kronos-settings", onSettings);
    return () => window.removeEventListener("kronos-settings", onSettings);
  }, []);
  useEffect(() => () => onVerify(null), [onVerify]);

  // Reads the edit buffer back and compares it with `file`'s open sound. quiet: show the strip on a mismatch only.
  async function check(file: typeof ws.file, quiet: boolean): Promise<void> {
    const t = tablesRef.current;
    const info = ws.info(slotKey);
    if (!link || !t) return;
    const sent = getEntry(file, slotKey, index).subarray(0, info.objectSize);
    const lk: LiveKind = info.kind === "combi" ? "combi" : info.type === "exi" ? "exi" : "hd1";
    try {
      // The keyboard only answers for the edit buffer of the mode it is in, so switch to this sound's mode first.
      link.send(modeBytes(info.kind === "combi" ? "combi" : "program", link.channel));
      await new Promise((r) => window.setTimeout(r, 300));
      const got = await readCurrentBytes(link.client, file, slotKey);
      const text = checkText(compareEditBuffer(sent, got, t, lk), soundName(sent), soundName(got), info.kind === "combi" ? "combi" : "program");
      const ok = text === "Keyboard matches this sound";
      if (!(quiet && ok)) onVerify({ ok, text });
    } catch (e) {
      const m = describeError(e);
      onVerify({ ok: false, text: /No reply/i.test(m) ? `${m} Check keyboard needs the keyboard to answer a current-sound request; if it stays silent, Live and A/B still work.` : m });
    }
  }
  async function checkNow() {
    setChecking(true);
    try {
      await check(ws.file, false);
    } finally {
      setChecking(false);
    }
  }
  // A failed send is shown; Live stays on.
  const sender = useMemo(
    () => (link ? new LiveSender({ client: link.client, channel: link.channel, key: slotKey, index, tables: () => tablesRef.current, single: () => singleRef.current }) : null),
    [link, slotKey, index],
  );
  const latest = useMemo(
    () =>
      sender
        ? new Latest(
            async (f: typeof ws.file) => {
              await sender.send(f);
              if (verifyRef.current) await check(f, true);
            },
            // Stays on: one failed send (a timeout, a busy keyboard) must not switch Live off for good; the next edit tries again.
            (e) => onError(describeError(e)),
          )
        : null,
    [sender, onError],
  );

  // Calls the slot up on the keyboard's channel, then fills its edit buffer. Only the mode change is never repeated for an edit.
  function callUp() {
    if (!link || locked || !latest) return;
    try {
      link.send(modeBytes(kind, link.channel));
      for (const b of selectBytes(slotKey, index, link.channel)) link.send(b);
    } catch (e) {
      setOn(false);
      localStorage.setItem(ON_KEY, "0");
      onError(describeError(e));
      return;
    }
    lastSent.current = Uint8Array.from(getEntry(ws.file, slotKey, index));
    // The program select makes the keyboard load the stored program into its edit buffer, which can overwrite a dump that arrives meanwhile: wait, send, then send once more.
    const mine = ++callToken.current;
    for (const ms of [SETTLE_MS, SETTLE_MS + RESEND_MS]) {
      window.setTimeout(() => {
        if (callToken.current !== mine || !sender || !onRef.current) return;
        sender.forget();
        latest.push(ws.file);
      }, ms);
    }
  }

  // Opening the slot (the parent keys this by slot), or the link coming up, while Live is on calls it up.
  useEffect(() => {
    if (on) callUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, slotKey, index]);

  // Each edit, undo included: push only when the slot's bytes differ from the last copy sent.
  useEffect(() => {
    if (!on || !latest || locked) return;
    const now = getEntry(ws.file, slotKey, index);
    if (sameBytes(lastSent.current, now)) return;
    lastSent.current = Uint8Array.from(now);
    latest.push(ws.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  // The AI run ended or was discarded: the keyboard may still hold the run's version while the bytes now match what was last sent, so the diff above would skip it.
  const resync = useRef<() => void>(() => {});
  resync.current = () => {
    if (!on || !latest || !link || ws.isHeld(slotKey, index) || lockedProp) return;
    lastSent.current = Uint8Array.from(getEntry(ws.file, slotKey, index));
    sender?.forget();
    latest.push(ws.file);
  };
  useEffect(() => {
    const h = () => resync.current();
    window.addEventListener("kronos-live-resync", h);
    return () => window.removeEventListener("kronos-live-resync", h);
  }, []);

  useEffect(() => () => { callToken.current++; }, []); // leaving the sound drops its pending sends

  function turnOn() {
    localStorage.setItem(CONFIRMED_KEY, "1");
    localStorage.setItem(ON_KEY, "1");
    setOn(true);
    callUp();
  }

  function toggle(next: boolean) {
    if (!next) {
      localStorage.setItem(ON_KEY, "0");
      setOn(false);
      return;
    }
    if (localStorage.getItem(CONFIRMED_KEY) === "1") turnOn();
    else ask(WARNING, "Turn on Live", turnOn);
  }

  const checkWhy = !link ? "Connect the Kronos first" : locked ? "Keep or discard the AI's changes first" : checking ? "Checking" : null;
  const verifyKey = (
    <>
    <button type="button" data-testid="check-keyboard" disabled={!!checkWhy} title={checkWhy ?? "Read the keyboard's edit buffer back and compare it with this sound"} onClick={() => void checkNow()}>Check keyboard</button>
    {checkWhy && checkWhy !== "Checking" && <small className="status" data-testid="check-why">{checkWhy}</small>}
    </>
  );
  return (
    <>
    <label className="check">
      <input type="checkbox" data-testid="live-edit" checked={on} disabled={!link || locked} onChange={(e) => toggle(e.target.checked)} />
      Live
      {single && <small data-testid="live-mode" title="Edits go to the keyboard as single parameters where possible">{" "}(single parameters)</small>}
    </label>
    {verifyHost && !themeA ? createPortal(verifyKey, verifyHost) : verifyKey}
    </>
  );
}
