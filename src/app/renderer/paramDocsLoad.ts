// Loads the Parameter Guide excerpts (src/generated/param-docs.json) once and hands them to the pure lookup; an empty or missing file just means no excerpts.
import { setParamDocs, type DocData } from "../../core/ai/paramDocs.ts";

let loading: Promise<void> | null = null;
export const ensureParamDocs = (): Promise<void> => (loading ??= import("../../generated/param-docs.json").then((m) => setParamDocs(m.default as DocData)).catch(() => {}));
