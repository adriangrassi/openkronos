// The agent loop: a model chats, asks for tools, gets results back, until it stops or runs out of turns.
// The model is injected as chat(), so this file knows nothing about the provider. No Node or DOM imports.
import { runTool, toolDefinitions, type Slot, type SoundSession } from "./session.ts";
import { accumulate, ZERO_USAGE, type Usage } from "./usage.ts";

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Message = { role: "system" | "user" | "assistant" | "tool"; content: string; toolCalls?: ToolCall[]; toolCallId?: string };
export type ChatReply = { content: string; toolCalls: ToolCall[]; usage?: Usage };
export type ChatFn = (messages: Message[], tools: ToolDef[]) => Promise<ChatReply>;
export type RunStatus = "done" | "turn-limit" | "error" | "cancelled";
export type RunResult = { status: RunStatus; finalText: string; error?: string; touched: Slot[]; messages: Message[]; steps: number; usage?: Usage };

export const DEFAULT_SYSTEM = `You design sounds for a KORG Kronos by configuring them through tools. The owner describes a sound and expects a finished, configured sound in the library, not advice.
Every run must end with a new sound you configured yourself:
1. search_sounds for a starting point. A sound that already has the requested name is a reference to read, never the answer: do not stop at it.
2. copy_sound the best starting point into a free slot, named for the new sound.
3. describe_sound the copy for its group list, then read every group that shapes the tone: oscillators, waveforms, pitch, mixer, filters, amp, envelopes, LFOs and modulation.
4. set_params across all of those groups until the copy matches the description: waveforms, levels, cutoff, resonance, envelope times and levels, LFOs, vibrato, velocity response. Change everything that needs changing, not one or two values.
5. Configure the effects too, because they are part of the sound. Read the Insert Effect, Master Effect and Total Effect groups, then set types, switches, wet/dry, sends and every effect setting to suit the sound. list_effect_types gives the type ids. After changing an Effect Type, read that group again and set its values: a new type starts near its lowest values, which can be silent. An oscillator reaches an Insert Effect through the bus setting in its Output group, so check the routing.
Richness checklist, checked before you say done:
- Layers: HD-1 uses both oscillators ([OSC1 Output], [OSC2 Output], [OSC2 Pitch]) and the velocity-switched or multisample layers where the sound benefits, with a small detune or an octave or interval doubling. EXi engines: use the second layer ([EXi2 Common]), unison or detune where the engine has it; read its groups first, never invent parameters.
- Envelopes shaped to the instrument ([OSC1 Filter EG], [OSC1 Amplifier EG]), with velocity and key tracking set ([OSC1 Filter Keyboard Track]).
- Some movement where the instrument has it: an LFO ([OSC1 LFO1]) or a mod wheel route.
- At least one insert effect chosen for the sound ([Insert Effect1]: chorus/ensemble, drive, EQ, compressor) and a Master reverb or delay send ([Master Effect1]), wet/dry sensible.
- The final EQ ([Total Effect]) balanced.
If a sound seems basic after reading it, add what is missing before finishing; say what you added.

Rules:
- Call several tools in one turn whenever you can, so the work takes few turns.
- Read a sound's groups in ONE describe_sound call (groups: up to 8 names), never one group per turn, then set the values in the same or the next turn.
- Old read results may be removed to save space. Read a group once; call it again only if you truly need a value that was removed.
- Build the Combi early: once the starting sounds are copied into free slots, and before you tune any part, call build_combi (one part per copied sound, on the key range the request asks for; a single sound is one part on 0 to 127). Then tune the parts one at a time with set_params. A run can stop at the turn limit, and a stop must never leave Programs with no Combi.
- If you are running out of turns, stop tuning and say in your final message what you did not get to.
- Check that every change can be heard. After your last write, read the settings you changed once more. A time, level or amount that moved by less than about 10% will not be heard: make it clearly larger, or say it is a small change.
- An effect is only heard if sound reaches it. For any effect request (delay, reverb, chorus), read the effect's Switch and Wet/Dry and the send level that feeds it (the Send1/Send2 of the oscillator or EXi Output), and raise a send that is zero. Set delay time, feedback and Wet/Dry so a request like "four long repeats" is clearly audible.
- Delays: "N repeats" means feedback sized so N echoes are audible, not N echoes inside one beat. Set the time to a note value of the sound's tempo (quarter, dotted eighth, eighth) and keep it above about 250 ms unless the owner asks for slapback, doubling or a very fast echo. If the wording is ambiguous, take the musical reading and say which one you chose.
- End with what changed, as old to new values, and what the owner should now hear. Never call an effect longer, louder or added unless your numbers show it, and say what you could not check.
- Read a group with describe_sound before setting it, and use the ids it returns.
- Never change a sound the owner did not ask you to change. New sounds go only into free slots (free_slots lists them). Never overwrite anything.
- For a split (for example bass on the left hand, brass on the right), the parts are the copied sounds on their key ranges, as in the Combi rule above.
- After build_combi, call configure_combi once for that Combi. Set tempo to the loaded song's tempo when a song is described, else to the requested tempo; otherwise KARMA stays at 120.
- When the request wants drums, a beat or arps: a Drum Track or KARMA module sounds only on the channel it outputs to, so give that part its own channel in build_combi (2, 3, ...) and use the same channel in configure_combi. Drums: drumTrack {on: true, channel}, with a drum kit part on that channel; patterns have no names, so leave pattern out and tell the owner to pick one. Arps, bass or comping: search_ge ("arp", "bass", "drum rock"), then karma.modules with ge, channel and the keyBottom/keyTop keys that trigger it, kept out of every other part's key range. A new Combi's Module A already runs an arpeggio: configure it, or set run false on every module you do not use.
- There is no KARMA master switch in the data: end your final message by telling the owner to press KARMA ON/OFF on the keyboard.
- You cannot hear the result. When the sound is configured, stop calling tools and say briefly what you set and what the owner should listen for.
- Keep every Combi part on the keyboard's own channel (leave channel out) so the owner can play it; give a part its own channel only when a KARMA module alone plays it. Build a playable arrangement of at most 8 parts (for example bass on the left hand, layers and leads on the right), not one part per song track. When a song is loaded and its tracks should get sounds for playback, list them in build_combi's trackSounds (track is the song track's channel number, 1 to 16, as shown in the loaded-song block); trackSounds are not written to the Combi.
- When the owner only wants existing sounds assigned to the song's tracks, call assign_tracks (not build_combi) and do not change any sound.
Adding to an existing sound, splits, oscillators and KARMA:
- Never edit the open sound for an add, layer or split request: it stays as part 1 of a new Combi (build_combi), and new sounds go in free slots.
- SGX-2, EP-1, AL-1, CX-3, STR-1, MS-20EX, PolysixEX and MOD-7 Programs have no OSC2, and set_params refuses OSC edits on them: layers on them are Combi parts, found with search_sounds or built from a copied HD-1 Program.
- Building a sound: copy_sound the closest HD-1 Program, set Oscillator Mode to Double (1) when it needs two layers, choose samples with list_multisamples and apply them with set_params {ms:{osc,zone,id}}, then shape the envelopes and filter for the role (pad: slow Amplifier attack, long release, low cutoff with slow movement; synth or lead: fast attack, mid cutoff and resonance, some filter envelope; bass: fast attack, low cutoff, short release), then effects and sends, and read it back.
- Notes: C-1 = 0, C3 = 48, middle C (C4) = 60, G9 = 127. A split uses adjacent key ranges (below C3: 0..47 and 48..127), a velocity switch adjacent velocity ranges; overlaps need a slope (0..15) to crossfade.
- KARMA: pick a GE with search_ge for the role, give the part it plays its own channel in build_combi, then configure_combi the module with ge, plays (that timbre number), inputChannel 16, and keyBottom/keyTop for the keys that start it; leave the other parts' modules off.
- If a loaded song is described, use its tempo and key, never invent parts for EMPTY tracks, and say which tracks are empty in your final message.`;
export const REFINE_TURNS = 6; // a Refine run is one small change, so it gets far fewer steps than a build
export const ASK_TURNS = 5;
// A small model wanders more than it finishes, so the local provider gets fewer steps; cloud keeps MAX/REFINE/ASK as they are.
export const LOCAL_TURNS = { build: 16, refine: 5, ask: ASK_TURNS };
export const ASK_SYSTEM = `You answer questions about a KORG Kronos sound by pointing at its settings, or by planning a layer. You cannot change anything and must never claim you did.
Which sound: the question starts with the sound the owner has open (name, bank, slot, engine). That is only the default. If the question names a different sound ("the piano", "INT-A 000", "Berlin Grand"), find it with search_sounds (or ask the owner which slot) and read that one. Never work on the open sound when it is a blank Init sound and the question names another sound. Say which sound you used.
Read the sound with describe_sound first (several groups in one call); its kind and engine fields tell you what it is: a Program, Combi, Drum Kit or Wave Sequence. The opening line says which kind is open.
To change a sound ("make it brighter"): call show_param for every setting you mention (1 to 4 in total), using the ids describe_sound returns. Set each note to a few words saying which way to move it, such as "Raise this" or "Lower this". Give each target a concrete suggest: the raw value you recommend, a whole number inside the min..max that describe_sound returned for it. List the targets in the order the owner should change them, because the editor walks them through one at a time.
To ADD or LAYER an instrument ("add strings to this piano", "layer a pad", "a bass an octave down"): do not nudge parameters. Read the base sound, then call propose_layer once, with add.role and a find word (or add.program from search_sounds); use add.transpose -12 for an octave down. method "combi" is right for every EXi engine (SGX-2, AL-1, CX-3, STR-1, MS-20EX, PolysixEX, MOD-7, EP-1), because those Programs have one engine and no second oscillator: a Combination plays two Programs together. Use method "osc2" only when the base engine is HD-1. The app turns the plan into numbered steps and a Build it for me button. If propose_layer says there is no free Combi slot, tell the owner.
Before saying you are unsure about a parameter or engine behaviour, call lookup_param_help; only admit uncertainty if it returns nothing, and then say what you do know.
Answer in at most 3 short sentences in plain language: which setting, which direction, and why. For a layer, answer in 2 sentences: which sounds and which method, and that the steps are shown. Never say the sound was changed. A MAX of ${ASK_TURNS} steps.`;

export const KIND_LABEL: Record<string, string> = { program: "Program", combi: "Combi", drumkit: "Drum Kit", waveseq: "Wave Sequence" };
// What each object kind other than a Program is made of, so the model reads and changes the right thing; the settings themselves come only from describe_sound.
export const KIND_HINT: Record<string, string> = {
  combi: "A Combination plays up to 16 timbres, each a Program. describe_sound on it returns timbres: the Program each active timbre plays (bank key, index, name, timbre numbers). The Combi's own settings (volume, pan, effect sends, key and velocity windows, per-timbre settings) are in its Timbre groups. To change how one part sounds (brighter pad, a bass with more attack), match the part to a timbre Program by name, then describe_sound and set_params on that Program with its key and index; only this Combi and those Programs may be written. Use the Combi's own settings for balance, panning, sends and ranges. To give a part a new sound (add a sax, a synth), call search_sounds for it, then on the Combi set that timbre's Status to on and its Bank Number and Program Number to the found Program (Bank Number: INT-A..F = 0..5, U-A..G = 17..23, U-AA..GG = 24..30; Program Number is the index), plus its key window (note numbers: C4 = 60, A0 = 21), volume and effect sends; turn off timbres you do not use. Never answer that you cannot search: search_sounds is available. Say which part and which Program you changed.",
  drumkit: "A Drum Kit has up to 128 notes, each with up to 8 sample zones (level, tune, filter, EQ, envelope) plus common settings (pan, bus, sends, exclusive group). describe_sound lists notesWithSamples and group patterns: read only groups named Note<N> Zone<Z>, Note<N> Velocity or Note<N> Common for notes in use. The choice of samples cannot be read or changed here.",
  waveseq: "A Wave Sequence has up to 64 steps (groups Step<N>) plus Common settings (loop, start and end step, duration, tempo mode). describe_sound lists the groups; read Common and the steps that matter. The choice of samples cannot be read or changed here.",
};

// The first line of an Ask: the sound the owner has open, so the model can tell a blank Init sound from the one they name.
export function askPrompt(open: { key: string; index: number; name: string; kind: string; engine: string; bank: string }, question: string): string {
  const init = open.name.trim() === "" || /^init/i.test(open.name.trim());
  const hint = KIND_HINT[open.kind];
  return `Open sound: ${KIND_LABEL[open.kind] ?? "Program"} ${open.bank} ${String(open.index).padStart(3, "0")} "${open.name}" (${open.key} ${open.index}), engine ${open.engine}${init ? ", a blank Init sound" : ""}.${hint ? ` ${hint}` : ""} Question: ${question}`;
}
// Lines appended to the system prompt of every run: plain wording always, then the owner's answer length and answer language.
export const PLAIN_LINE = 'Use plain musical words. Say values the way the app shows them (Poly, Mono, 64), never as raw numbers such as "raw 0", and do not say that nothing was changed or that this is an explanation only unless asked.';
export const LENGTH_LINE: Record<"brief" | "normal" | "detailed", string> = {
  brief: "Answer in at most 2 short sentences (about 35 words): what it does and the one most useful tip. No raw values or ids unless essential.",
  normal: "",
  detailed: "Answer more fully than usual, overriding any sentence limit above: explain what it does, the typical settings and the common gotchas.",
};
export const PORTUGUESE_LINE = "Answer in Brazilian Portuguese. Keep parameter names, bank names, numbers and note names (C4, INT-A 000) exactly as the app shows them.";
export const NO_NAME_LINE = { en: "Do not mention the name of the open sound, program or combination or its bank slot; go straight to the answer.", pt: "Não mencione o nome do som, programa ou combinação aberto nem a posição dele no banco; vá direto à resposta." };
export function answerStyle(lang: "en" | "pt", length: "brief" | "normal" | "detailed"): string {
  return [PLAIN_LINE, NO_NAME_LINE[lang], LENGTH_LINE[length], lang === "pt" ? PORTUGUESE_LINE : ""].filter(Boolean).map((l) => `
${l}`).join("");
}
// Models answer in the language of the question, so for Portuguese the line also leads the system prompt and a Portuguese line leads the user prompt.
export const PORTUGUESE_PROMPT_LINE = "Responda em português do Brasil. Mantenha nomes de parâmetros, bancos, números e notas exatamente como o app mostra.";
export function systemFor(base: string, lang: "en" | "pt", length: "brief" | "normal" | "detailed"): string {
  return (lang === "pt" ? `${PORTUGUESE_LINE}
` : "") + base + answerStyle(lang, length);
}
export const userPromptFor = (prompt: string, lang: "en" | "pt"): string => (lang === "pt" ? `${PORTUGUESE_PROMPT_LINE}
${prompt}` : prompt);
const NOT_CONFIGURED = "You have not configured anything yet. Copy the best starting point into a free slot and set its parameters now.";

// Older long tool results are dropped from the prompt sent to the model; the caller keeps the full history.
export function compactForModel(messages: Message[]): Message[] {
  const assistants = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  const cut = assistants.length < 2 ? 0 : assistants[assistants.length - 2];
  return messages.map((m, i) =>
    i < cut && m.role === "tool" && m.content.length > 400
      ? { ...m, content: '{"removed":"Older result removed to save space. Call the tool again if you still need it."}' }
      : m,
  );
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function runAgent(opts: {
  session: SoundSession;
  prompt: string;
  chat: ChatFn;
  maxTurns: number;
  signal?: AbortSignal;
  system?: string;
}): Promise<RunResult> {
  const { session, chat, signal } = opts;
  const tools = toolDefinitions(session.ask ? "ask" : session.onlySlot !== undefined ? "refine" : "build");
  const messages: Message[] = [
    { role: "system", content: opts.system ?? DEFAULT_SYSTEM },
    { role: "user", content: opts.prompt },
  ];
  let finalText = "";
  let usedTools = false;
  let nudges = 0; // a model that only looks things up is told to do the work, at most twice
  let steps = 0;
  let usage: Usage | undefined; // stays undefined when no step reports usage
  const finish = (status: RunStatus, error?: string): RunResult => ({ status, finalText, error, touched: session.touched(), messages, steps, usage });
  try {
    for (let turn = 0; turn < opts.maxTurns; turn++) {
      if (signal?.aborted) return finish("cancelled");
      const reply = await chat(messages, tools);
      steps++;
      if (reply.usage) usage = accumulate(usage ?? ZERO_USAGE, reply.usage);
      // A cancel during the model call stops here, before any tool runs.
      if (signal?.aborted) return finish("cancelled");
      const calls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
      finalText = reply.content ?? "";
      messages.push({ role: "assistant", content: finalText, toolCalls: calls });
      if (calls.length === 0) {
        if (usedTools && !session.ask && nudges < 2 && session.touched().length === 0) {
          nudges++;
          messages.push({ role: "user", content: NOT_CONFIGURED });
          continue;
        }
        return finish("done");
      }
      usedTools = true;
      for (const c of calls) {
        // The local adapter flags arguments it could not decode, so the model is told instead of the tool running on {}.
        const bad = c.arguments?._argsError;
        const result = typeof bad === "string" ? { ok: false, error: bad } : runTool(session, c.name, c.arguments);
        messages.push({ role: "tool", toolCallId: c.id, content: JSON.stringify(result) });
      }
    }
    return finish("turn-limit");
  } catch (e) {
    return finish("error", msg(e));
  }
}

// Tool definitions in the OpenAI function-calling shape that local routers expect.
export function toOpenAiTools(defs: ToolDef[]): { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] {
  return defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.input_schema } }));
}
