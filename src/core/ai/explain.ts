// Shift-click on a control asks the AI about it. This file builds the question and the offline answer from plain data; it touches no DOM and no sound.
import { ENGINE_DESC } from "./engineNotes.ts";
import { lookupParamDoc } from "./paramDocs.ts";
export type ControlKind = "dial" | "fader" | "slider" | "number" | "select" | "checkbox" | "toggle" | "button" | "tab" | "text" | "node" | "other";

export type ExplainCtx = {
  label: string;
  kind?: ControlKind;
  testid?: string;
  // Where the control sits: the page or tab and the parameter group.
  page?: string;
  group?: string;
  soundKind?: string;
  // Not used in any text: the answer must not name the open sound.
  soundName?: string;
  // The open sound's engine (SGX-2, AL-1, HD-1, ...): data for the question and part of the saved-answer key, unlike the sound's name.
  engine?: string;
  value?: string;
  min?: number;
  max?: number;
  help?: string;
  // The control's own tooltip or description text, when the app wrote one.
  hint?: string;
  disabled?: boolean;
};

export type ExplainRequest = {
  label: string;
  // What goes to the model as the Ask question.
  question: string;
  // What the AI window shows when no model answers.
  offline: string;
  // True when the app had more than a label to teach from.
  grounded: boolean;
  // "Current value: 64", worked out here and shown beside the answer, never sent to the model, so one saved answer fits every value.
  valueLine: string;
};

export const EXPLAIN_HINT = "Shift-click any control to ask the AI about it";
export const MAX_HELP = 1200;

const USAGE: Record<ControlKind, string> = {
  dial: "Drag it up or down to turn it (hold Shift while dragging for fine steps), use the mouse wheel (Shift for fine steps), double-click to return to the saved value, or focus it and use the arrow keys.",
  fader: "Drag the cap, use the mouse wheel (Shift for fine steps), or focus it and use the arrow keys. Hold Shift while dragging for fine steps.",
  slider: "Drag the slider or focus it and use the arrow keys; the number box beside it takes a typed value.",
  number: "Type a value and press Enter or leave the box; the wheel steps it.",
  select: "Click it and pick an entry from the list.",
  checkbox: "Click it to switch it on or off, or focus it and press Space.",
  toggle: "Click it to switch it on or off.",
  button: "Click it to run it.",
  tab: "Click it to show that page.",
  text: "Click in the box and type; press Enter or leave the box to confirm.",
  "node": "Click it to select that part of the signal path.",
  other: "Click it to use it.",
};

// The offline text in Brazilian Portuguese. Parameter labels and values stay as the app shows them, and so do the factory help texts (English).
const USAGE_PT: Record<ControlKind, string> = {
  dial: "Arraste para cima ou para baixo para girar (segure Shift ao arrastar para passos finos), use a roda do mouse (Shift para passos finos), dê um clique duplo para voltar ao valor salvo, ou foque nele e use as setas.",
  fader: "Arraste o botão, use a roda do mouse (Shift para passos finos), ou foque nele e use as setas. Segure Shift ao arrastar para passos finos.",
  slider: "Arraste o controle deslizante ou foque nele e use as setas; a caixa de número ao lado aceita um valor digitado.",
  number: "Digite um valor e pressione Enter ou saia da caixa; a roda do mouse muda o valor aos poucos.",
  select: "Clique e escolha uma entrada da lista.",
  checkbox: "Clique para ligar ou desligar, ou foque nele e pressione Espaço.",
  toggle: "Clique para ligar ou desligar.",
  button: "Clique para executar.",
  tab: "Clique para mostrar essa página.",
  text: "Clique na caixa e digite; pressione Enter ou saia da caixa para confirmar.",
  "node": "Clique para selecionar essa parte do caminho do sinal.",
  other: "Clique para usar.",
};
const KIND_NAME_PT: Record<ControlKind, string> = { dial: "botão giratório", fader: "fader", slider: "controle deslizante", number: "caixa de número", select: "lista suspensa", checkbox: "caixa de seleção", toggle: "chave liga/desliga", button: "botão", tab: "aba", text: "caixa de texto", "node": "nó de roteamento", other: "controle" };
const PT_NOTE = "texto de ajuda original em inglês";

const KIND_NAME: Record<ControlKind, string> = { dial: "dial", fader: "fader", slider: "slider", number: "number box", select: "drop-down list", checkbox: "check box", toggle: "toggle", button: "button", tab: "tab", text: "text box", "node": "routing node", other: "control" };

// One line per Settings field, keyed by test id (a trailing -part falls back to its prefix, so settings-theme-a and settings-theme-studio share one entry).
export const SETTING_HELP: Record<string, string> = {
  "settings-open": "Opens the Settings dialog: theme, accent colour, UI scale, density, MIDI channels, live parameter sending and the AI connection.",
  "settings-close": "Closes the Settings dialog. Changes apply as soon as you make them, so there is nothing to confirm.",
  "settings-reset": "Puts every setting back to its default value.",
  "settings-theme": "Chooses the look of the whole app (one of the three themes). It changes colours and control faces only, never the sound.",
  "settings-accent": "Chooses the accent colour used for highlights. Theme keeps the chosen theme's own accent.",
  "settings-scale": "Scales the whole interface from 90% to 125%. Default 100%.",
  "settings-density": "Compact fits more on screen; Comfortable gives rows and controls more room.",
  "settings-channel": "The MIDI channel the app uses when it plays notes or sends parameter changes. Keyboard follows the channel the Kronos reports; Auto and the file's own choice are also offered, or pick channel 1 to 16.",
  "settings-global-channel": "The Kronos Global MIDI channel, used for the Volume slider in the dock. Your keyboard shows it under GLOBAL, MIDI. File uses the value stored in the open file.",
  "settings-liveparams": "Off by default. When on and a keyboard is connected, each parameter change is also sent to the keyboard as it happens, so you hear it at once. When off, changes stay in the file until you press Send.",
  "settings-verifylive": "Off by default. When on, live parameter sends are checked by reading the value back from the keyboard, so a lost message shows up.",
  "settings-ai-url": "The base URL of the local AI router, used when the provider is Local. Only http or https addresses without a user name or password are accepted.",
  "settings-ai-model": "The model name sent to the local router. Letters, digits and . _ : / @ + - only.",
  "settings-clear-answers": "Forgets every saved AI answer on this computer, so the next explanation or question asks the AI again. It changes no sound.",
  "settings-scale-value": "The current UI scale as a percentage.",
  "settings-global-channel-hint": "A note on where to find the Global MIDI channel on the keyboard.",
};

// The app's own buttons and pickers, so the offline answer teaches more than the label. Keyed by test id; only what the code is sure of.
export const APP_HELP: Record<string, string> = {
  "send-sound": "Sends the open sound from this file to the keyboard's memory. It is a real MIDI transfer and replaces the sound in that slot on the keyboard.",
  "sync-keyboard": "Sends the changed sounds in this file to the keyboard.",
  "check-keyboard": "Checks that the keyboard's memory matches what this app expects, without changing anything on the keyboard.",
  "store-bank": "Stores the open bank into the keyboard's permanent memory.",
  "compare-toggle": "Shows the saved values next to the edited ones so you can see what you changed.",
  "live-mode": "Turns live editing on or off: while it is on, edits are heard on the keyboard as you make them.",
  "live-edit": "Turns live editing on or off: while it is on, edits are heard on the keyboard as you make them.",
  "dock-sustain": "Holds the sound's notes as a sustain pedal would, for the notes you play from the on-screen keyboard.",
  "dock-velocity": "The loudness (velocity 1 to 127) used for notes played from the on-screen keyboard.",
  "dock-mod": "The modulation wheel value sent while you play from the on-screen keyboard.",
  "dock-pitch": "The pitch-bend value sent while you play from the on-screen keyboard.",
  "dock-volume": "The keyboard's master volume, sent on the Global MIDI channel.",
  "dock-octave": "Shifts the on-screen keyboard up or down by octaves.",
  "undo": "Undoes the last edit in this file.",
  "redo": "Redoes the edit you just undid.",
  "save-file": "Saves the open file to disk.",
  "save-as": "Saves the open file under a new name.",
  "open-file": "Opens a PCG file from disk.",
  "view-panel": "Shows the sound as a panel of dials, faders and switches.",
  "view-list": "Shows every parameter of the sound as a list with sliders.",
  "view-keyboard": "Shows the sound laid out like the keyboard's own screens.",
  "view-kronos": "Shows the sound in the Kronos screen layout.",
  "view-simple": "Shows a short list of the controls that matter most.",
  "ai-conn-use": "Makes this the AI that answers in the AI window: Ask, Refine and Shift-click explanations all use it. Nothing is sent until you use an AI feature.",
  "ai-conn-check": "Looks at this computer to see whether the app is installed and signed in. It sends nothing to the AI company and never reads your password.",
  "ai-conn-test": "Sends one tiny real question to see that the connection works from end to end, and shows how long it took. It uses a little of your own plan.",
  "ai-conn-copy": "Copies this command so you can paste it into a terminal.",
  "ai-conn-model": "Which Claude model answers. Sonnet is balanced, Haiku is fastest and lightest on your plan limits, Opus is the strongest and uses your limits fastest.",
  "ai-conn-guide": "Shows or hides the step by step setup guide for connecting an AI.",
  "ai-open": "Opens the AI window, where you describe a sound, refine the open one, or ask a question about it.",
  "ask-go": "Asks the AI a question about the open sound. Ask never changes the sound.",
  "refine-go": "Asks the AI to change the open sound as you describe. Its changes wait for your Keep or Discard.",
  "shell-help-button": "Opens the Help panel with the keyboard shortcuts.",
  "settings-dialog": "The Settings dialog.",
};

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const lookup = (table: Record<string, string>, id: string | undefined): string | undefined => {
  for (let k = id; k; k = k.includes("-") ? k.slice(0, k.lastIndexOf("-")) : "") if (Object.hasOwn(table, k)) return table[k];
  return undefined;
};

// "check-keyboard" becomes "Check keyboard": only for a control that has no label of its own.
export function humanizeId(id: string): string {
  const s = id.replace(/\$\{[^}]*\}/g, "").replace(/[-_.]+/g, " ").replace(/\s+\d+(\s+\d+)*$/, "").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// length "brief" is the owner's Very brief answer setting: the offline text shrinks to the label, a one-line purpose and the current value.
export function describeControl(ctx: ExplainCtx, length: "brief" | "normal" | "detailed" = "normal", lang: "en" | "pt" = "en"): ExplainRequest {
  const label = ctx.label.trim().replace(/\s+/g, " ") || humanizeId(ctx.testid ?? "") || "Unnamed control";
  const kind = ctx.kind ?? "other";
  const own = lookup(SETTING_HELP, ctx.testid?.startsWith("settings-") ? ctx.testid : undefined) ?? lookup(APP_HELP, ctx.testid);
  const help = clip((ctx.help ?? own ?? "").trim(), MAX_HELP);
  // Only a parameter control (it has a group) is looked up: a plain button called Send is not the effect send.
  const doc = ctx.group ? lookupParamDoc({ label, page: ctx.page, group: ctx.group, engine: ctx.engine, kind: ctx.soundKind }) : null;
  const range = ctx.min !== undefined && ctx.max !== undefined ? `${ctx.min} to ${ctx.max}` : "";
  const facts = [
    `Control: ${label} (${KIND_NAME[kind]})`,
    ctx.page ? `Page: ${ctx.page}` : "",
    ctx.group ? `Group: ${ctx.group}` : "",
    ctx.soundKind ? `Open sound: a ${ctx.soundKind}` : "",
    ctx.value !== undefined && ctx.value !== "" ? `Current value: ${ctx.value}` : "",
    range ? `Raw range: ${range}` : "",
    ctx.disabled ? `This control is currently disabled${ctx.hint ? `: ${ctx.hint}` : ""}` : ctx.hint ? `Its tooltip says: ${ctx.hint}` : "",
  ].filter(Boolean);
  const usage = USAGE[kind];
  // The model's question holds nothing that belongs to one sound or one moment (name, value): its answer is saved and reused for the same control on any sound of the same engine.
  const engineLine = ctx.engine ? `Open sound engine: ${ctx.engine}${ENGINE_DESC[ctx.engine] ? ` (${ENGINE_DESC[ctx.engine]})` : ""}` : "";
  const qfacts = facts.filter((f) => !f.startsWith("Open sound:") && !f.startsWith("Current value:"));
  const grounding = doc
    ? `Parameter Guide text (${doc.source}). Answer from it and do not say you are unsure; if it does not cover this engine, give the general behaviour confidently and say what is documented:\n${doc.excerpt}`
    : help ? `Factory help text (ground your answer in it):\n${help}` : "No factory help text exists for this control in the app.";
  const question = [
    `Explain the control "${label}" in plain language for a Kronos owner.`,
    ...qfacts,
    ...(ctx.soundKind ? [`Open sound kind: ${ctx.soundKind}`] : []),
    ...(engineLine ? [engineLine] : []),
    grounding,
    length === "brief" ? "Keep it very short: what it does and the one most useful tip." : `Cover: what it does musically, its range, units, typical settings, how to use it${ctx.soundKind ? `, and any gotchas for a ${ctx.soundKind}` : ""}. In this app: ${usage}`,
    `This is a read-only explanation: leave the sound untouched, and do not read it or repeat its name. The current value is shown separately.${doc ? "" : " Before saying you are unsure, call lookup_param_help."}`,
  ].join("\n");
  const pt = lang === "pt";
  const purposeText = pt ? USAGE_PT[kind] : help || usage;
  const purpose = purposeText.split(/(?<=[.!?])\s/)[0].trim();
  const factsPt = [
    `Controle: ${label} (${KIND_NAME_PT[kind]})`,
    ctx.soundKind ? `Som aberto: ${ctx.soundKind}` : "",
    ctx.value !== undefined && ctx.value !== "" ? `Valor atual: ${ctx.value}` : "",
    range ? `Faixa bruta: ${range}` : "",
    ctx.disabled ? `Este controle está desativado no momento${ctx.hint ? `: ${ctx.hint}` : ""}` : ctx.hint ? `A dica dele diz: ${ctx.hint}` : "",
  ].filter(Boolean);
  const offline = pt
    ? length === "brief" ? `${label}: ${purpose}${ctx.value ? ` Agora: ${ctx.value}.` : ""}` : [
      `${label}${ctx.page || ctx.group ? ` (${[ctx.page, ctx.group].filter(Boolean).join(", ")})` : ""}`,
      ...factsPt.slice(1),
      help ? `\n${help}\n(${PT_NOTE})` : "",
      `\nComo usar: ${USAGE_PT[kind]}`,
    ].filter(Boolean).join("\n")
    : length === "brief" ? `${label}: ${purpose}${ctx.value ? ` Now: ${ctx.value}.` : ""}` : [
      `${label}${ctx.page || ctx.group ? ` (${[ctx.page, ctx.group].filter(Boolean).join(", ")})` : ""}`,
      ...facts.slice(1).filter((f) => !f.startsWith("Page:") && !f.startsWith("Group:")),
      help ? `\n${help}` : "",
      `\nHow to use it: ${usage}`,
    ].filter(Boolean).join("\n");
  const valueLine = ctx.value !== undefined && ctx.value !== "" ? `${pt ? "Valor atual" : "Current value"}: ${ctx.value}` : "";
  return { label, question, offline, grounded: !!(help || doc || ctx.value || range || ctx.hint), valueLine };
}
