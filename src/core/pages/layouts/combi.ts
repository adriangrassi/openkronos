// Combination screens: P0 Play (0-8), P1 EQ/Vector/Controller, P2 Timbre Parameters, P3 MIDI Filter/Zones, P7 KARMA (karma.ts). 0-1 is the mixer (KronosMixer.tsx); P8 and P9 routing and Insert FX in fx.ts (8-7 and 9-2..9-5 are drawn by the effect page).
import type { LayoutSpec } from "../layout.ts";
import { combiP0Layouts } from "./combi-p0.ts";
import { combiP1Layouts } from "./combi-p1.ts";
import { combiP2Layouts } from "./combi-p2.ts";
import { combiP3Layouts } from "./combi-p3.ts";
import { karmaCombiLayouts } from "./karma.ts";
import { fxCombiLayouts } from "./fx.ts";

export const combiLayouts: LayoutSpec = { ...combiP0Layouts, ...combiP1Layouts, ...combiP2Layouts, ...combiP3Layouts, ...karmaCombiLayouts, ...fxCombiLayouts };
