// What KORG's Parameter Guide says about which settings an engine does not support, in our own words with the guide page. Pure data: the packaged app
// must not depend on the owner's private guide text for these, and they are the facts a model most often says it is unsure about.
export type EngineNote = { text: string; page: number; applies: { label: string; group?: string }[] };

export const ENGINE_DESC: Record<string, string> = {
  "HD-1": "HD-1 sample-based engine",
  "SGX-1": "SGX-1 piano (HD-1 sample-based engine)",
  "SGX-2": "SGX-2 Premium Piano EXi engine",
  "EP-1": "EP-1 MDS electric piano EXi engine",
  "AL-1": "AL-1 analog synth EXi engine",
  "CX-3": "CX-3 tonewheel organ EXi engine",
  "STR-1": "STR-1 plucked string EXi engine",
  "MS-20EX": "MS-20EX analog synth EXi engine",
  "PolysixEX": "PolysixEX analog synth EXi engine",
  "MOD-7": "MOD-7 waveshaping VPM EXi engine",
};

const UNISON = [{ label: "Unison" }, { label: "Number of Voices", group: "unison" }, { label: "Detune", group: "unison" }, { label: "Thickness", group: "unison" }];
const LEGATO = [{ label: "Poly Legato" }, { label: "Mode", group: "legato" }, { label: "Use Legato Offset" }];
const SAMPLE_ONLY = "Poly Legato and Mono Mode (Normal or Use Legato Offset) are designed for sample playback, so they do not apply to the";

export const ENGINE_NOTES: Record<string, EngineNote> = {
  "SGX-2": {
    text: "The SGX-2 supports most EXi common settings but not these voice-assign options: Poly Legato, Mono Mode (Normal or Use Legato Offset), and Unison with its Number of Voices, Detune and Thickness. They do not apply to this piano. The other voice-assign options work.",
    page: 397,
    applies: [...LEGATO, ...UNISON],
  },
  "EP-1": {
    text: "The EP-1 supports most EXi common settings but not these voice-assign options: Poly Legato, Mono Mode (Normal or Use Legato Offset), and Unison with its Number of Voices, Detune and Thickness. Half-Damper is always active on the EP-1, whatever Enable Half-Damper says.",
    page: 405,
    applies: [...LEGATO, ...UNISON, { label: "Enable Half-Damper" }],
  },
  "AL-1": { text: `${SAMPLE_ONLY} AL-1. All other voice-assign options (Mono, Mono Legato, Unison and the rest) are fully supported.`, page: 189, applies: LEGATO },
  "STR-1": { text: `${SAMPLE_ONLY} STR-1. All other voice-assign options (Mono, Mono Legato, Unison and the rest) are fully supported.`, page: 255, applies: LEGATO },
  "MS-20EX": { text: `${SAMPLE_ONLY} MS-20EX. All other voice-assign options (Mono, Mono Legato, Unison and the rest) are fully supported.`, page: 303, applies: LEGATO },
  "PolysixEX": { text: `${SAMPLE_ONLY} PolysixEX. All other voice-assign options (Mono, Mono Legato, Unison and the rest) are fully supported.`, page: 331, applies: LEGATO },
  "MOD-7": { text: `${SAMPLE_ONLY} MOD-7. All other voice-assign options (Mono, Mono Legato, Unison and the rest) are fully supported.`, page: 345, applies: LEGATO },
  "CX-3": {
    text: "The CX-3 does not support these voice-assign options: Single Trigger (it always acts as if it were On), Poly Legato, Mono Legato (plain Mono retrigger works) and Mono Mode (Normal or Use Legato Offset). It also has no scales.",
    page: 231,
    applies: [...LEGATO, { label: "Single Trigger" }, { label: "Mono Legato" }],
  },
};
