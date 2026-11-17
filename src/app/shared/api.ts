import type { Settings } from "../../core/settings.ts";
import type { SpeechResult, VoicesResult } from "../main/speech.ts";
import type { SecretName } from "../../core/secrets.ts";
// Everything the renderer may ask the main process for. No operation takes a file path from the renderer.
import type { ChatReply, Message, ToolDef } from "../../core/ai/agent.ts";
import type { ProviderId, ProviderStatus, TestResult } from "../../core/ai/connect.ts";
import type { BackupSummary } from "../../core/backup/manifest.ts";
import type { SyncState } from "../../core/device/syncstate.ts";
import type { MidiHit, SiteId } from "../../core/midi/sites.ts";
import type { LibraryData } from "../../core/pcg/catalog.ts";
import type { Snapshot } from "../../core/pcg/snapshots.ts";

export interface AiUsageRow {
  time: string;
  request: string;
  steps: number;
  input: number;
  cached: number;
  output: number;
  total: number;
  song: string | null;
}

export type AiRoute = { provider: "cloud" | "claude" | "local"; model?: string };

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  // Set by a startup reopen: a one-line message, and true when the file has no path to save to.
  notice?: string;
  unnamed?: boolean;
}

export interface BackupFile {
  name: string; // relative: "file.ext" or "folder/file.ext"
  bytes: Uint8Array;
}

export interface MidiLibraryEntry {
  name: string;
  size: number;
  modified: number;
}

// Recent Files as the renderer sees them: no path, only an opaque id and the file name.
export interface RecentItem {
  id: string;
  name: string;
}

export interface RecentState {
  items: RecentItem[];
  reopenLast: boolean;
}

export interface KronosApi {
  // True only in a KRONOS_E2E=1 launch.
  readonly e2e: boolean;
  // True only in a KRONOS_E2E=1 launch with KRONOS_E2E_BARE_SIM=1: connect-sim works with no file open.
  readonly e2eBareSim: boolean;
  // Test only: comma list of effect type ids the effects page treats as undeterminable.
  readonly e2eEffectsUnknown: string;
  readonly e2eVariationsSeed: number | null;
  open(): Promise<OpenedFile | null>;
  confirmOpen(): Promise<void>;
  forgetPath(): Promise<void>;
  // Asks for a Standard MIDI File (or reads the KRONOS_E2E_MIDI path in e2e). The renderer never sends a path.
  midiOpen(): Promise<OpenedFile | null>;
  // MIDI browser: search one site, save one result to the library (returns the saved name), and the library folder.
  midiSearch(site: SiteId, query: string): Promise<MidiHit[]>;
  midiDownload(site: SiteId, ref: string, title: string): Promise<string>;
  midiLibraryList(): Promise<MidiLibraryEntry[]>;
  midiLibraryRead(name: string): Promise<Uint8Array>;
  midiLibraryDelete(name: string): Promise<void>;
  // Opens the MIDI file dialog and copies the file into the library. Returns the saved name, or null if cancelled.
  midiLibraryImport(): Promise<string | null>;
  // The MIDI playlist (library file names, in queue order), kept in ~/OpenKronos/playlist.json. Save rejects anything but plain .mid names.
  playlistLoad(): Promise<string[]>;
  playlistSave(items: string[]): Promise<void>;
  // Recorder: the event limit (lower only in e2e) and saving a take as a new .mid in the library (returns the name).
  midiRecordMax(): Promise<number>;
  midiSaveTake(bytes: Uint8Array): Promise<string>;
  // Asks for a .PCG to compare against (or reads the KRONOS_E2E_COMPARE path in e2e). Bytes only: the renderer never gets a path, and the file is never written.
  compareOpen(): Promise<OpenedFile | null>;
  saveAs(bytes: Uint8Array): Promise<string | null>;
  // Bank list export: the main process shows the save dialog and writes the text. Returns the file's base name, or null when cancelled.
  bankToolsExport(format: "csv" | "html", content: string): Promise<string | null>;
  // .ksound packs: save dialog (returns the base name or null) and open dialog (bytes only, size-limited). E2E env vars replace the dialogs.
  exchangeSave(content: string): Promise<string | null>;
  exchangeOpen(): Promise<OpenedFile | null>;
  save(bytes: Uint8Array): Promise<string>;
  writeBackup(name: string, bytes: Uint8Array): Promise<string>;
  // A full backup is written in two steps: begin makes an empty folder and returns its name; write adds files and returns each file's SHA-256 (computed in the main process).
  backupBegin(name: string): Promise<string>;
  backupWrite(folder: string, files: BackupFile[]): Promise<Record<string, string>>;
  // Crash recovery: bytes only, never a path. Main validates the id and the .PCG, writes atomically and keeps 3 copies per document.
  recoveryWrite(docId: string, bytes: Uint8Array): Promise<void>;
  recoveryClear(docId: string): Promise<void>;
  recoveryPeek(): Promise<Uint8Array | null>;
  pullCacheSave(bytes: Uint8Array): Promise<void>;
  pullCacheLoad(): Promise<{ bytes: Uint8Array; savedAt: number } | null>;
  recoveryDiscard(): Promise<void>;
  recoveryInterval(): Promise<number>;
  // Backup Manager: every name is a plain "Kronos Backup ..." folder name, never a path.
  backupList(): Promise<{ name: string; bytes: number; summary: BackupSummary | null }[]>;
  backupVerify(name: string): Promise<{ ok: boolean; checked: number; problems: { file: string; kind: string }[] }>;
  backupOpen(name: string): Promise<OpenedFile | null>;
  backupReveal(name: string): Promise<void>;
  backupDelete(name: string): Promise<void>;
  onCloseRequest(cb: () => void): () => void;
  confirmClose(): Promise<void>;
  // Puts text on the system clipboard (the MIDI monitor's copy).
  copyText(text: string): Promise<void>;
  // Sound Browser library (favorites, tags, notes). Save validates in the main process and rejects bad data.
  soundLibraryLoad(): Promise<{ data: LibraryData; corrupt: boolean }>;
  soundLibrarySave(data: LibraryData): Promise<void>;
  // Named snapshots per sound; the main process picks the file. Load keeps a corrupt file as .bad and returns [].
  snapshotsLoad(name: string, engine: string): Promise<Snapshot[]>;
  snapshotsSave(name: string, engine: string, list: Snapshot[]): Promise<void>;
  // One model turn for the AI panel. The key stays in the main process.
  settingsGet(): Promise<Settings>;
  settingsSet(patch: unknown): Promise<Settings>;
  aiChat(messages: Message[], tools: ToolDef[], route?: AiRoute): Promise<ChatReply>;
  // Stops a model request in flight (the local router; the cloud provider stops between turns).
  aiCancel(): Promise<void>;
  // Whether AUTOROUTER_KEY is set in the main process. The key itself never reaches the renderer.
  aiLocalReady(): Promise<boolean>;
  // Whether a provider can be used right now (version and sign-in state only, never a credential), and one tiny real call that reports its latency or a typed failure.
  aiProviderStatus(id: ProviderId): Promise<ProviderStatus>;
  aiTest(id: ProviderId): Promise<TestResult>;
  // One chunk of an AI answer spoken by the configured speech server (WAV bytes or a typed error); speechCancel stops the request in flight.
  speechSynthesize(req: { text: string; lang: "en" | "pt"; voice: string; speed: number }): Promise<SpeechResult>;
  openLink(url: string): Promise<boolean>;
  speechCancel(): Promise<void>;
  // The ElevenLabs voices of the saved key (main process, typed error when there is no key or it is refused).
  speechVoices(): Promise<VoicesResult>;
  // Speech keys are write-only here: set, clear, and ask whether one is stored. Nothing returns a key.
  secretsSet(name: SecretName, value: string): Promise<{ ok: true } | { ok: false; error: string }>;
  secretsClear(name: SecretName): Promise<boolean>;
  secretsHas(name: SecretName): Promise<boolean>;
  // Saved AI answers (userData/ai-answers.json): get a finished answer by its key, save one (false when refused or the disk write failed), clear all, and how many are kept.
  aiCacheGet(key: string): Promise<string | null>;
  aiCachePut(key: string, text: string): Promise<boolean>;
  aiCacheClear(): Promise<boolean>;
  aiCacheStats(): Promise<{ count: number; bytes: number }>;
  // Appends a run or decision row to ai-runs.jsonl (see core/ai/runlog.ts).
  aiRunLog(row: unknown): Promise<void>;
  // Appends one finished AI run to ai-usage.jsonl. A failed write must not stop the run.
  aiUsageLog(row: AiUsageRow): Promise<void>;
  // Sync to keyboard's record of what the keyboard held after the last sync (userData/sync-state.json).
  syncStateGet(): Promise<SyncState>;
  syncStateSet(state: SyncState): Promise<void>;
  // Recent Files: the list and the reopen-at-start setting. Opening by id reads the main process's path, never a renderer path.
  recent(): Promise<RecentState>;
  recentOpen(id: string): Promise<OpenedFile>;
  // The newest recent file, when the reopen setting is on; null otherwise.
  reopenLast(): Promise<OpenedFile | null>;
  clearCache(): Promise<void>;
  setReopenLast(on: boolean): Promise<void>;
}

export interface E2EHooks {
  ramName(key: string, index: number): string;
  storedName(key: string, index: number): string;
  setLatency(ms: number): void;
  midiLog(): number[][];
  injectMidi(bytes: number[]): void;
  liveCounts(): { dumps: number; paramChanges: number };
  masterVolume(): { count: number; last: number | null };
  setListSelect(): { count: number; set: number; slot: number } | null;
  editBuffer(obj: number): number[] | null;
  tamperEditBuffer(obj: number, offset: number, xor: number): void;
  keyboardRename(obj: number, bank: number, index: number, name: string): void; // the simulated keyboard holds a different sound in this slot, stored and in temporary memory
}

declare global {
  interface Window {
    kronos: KronosApi;
    __kronosE2E?: E2EHooks;
  }
}
