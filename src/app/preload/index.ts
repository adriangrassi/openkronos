import { contextBridge, ipcRenderer } from "electron";
import type { ChatReply, Message, ToolDef } from "../../core/ai/agent.ts";
import type { ProviderStatus, TestResult } from "../../core/ai/connect.ts";
import type { AiRoute, AiUsageRow, BackupFile, KronosApi, MidiLibraryEntry, OpenedFile, RecentState } from "../shared/api.ts";
import type { MidiHit, SiteId } from "../../core/midi/sites.ts";
import type { Settings } from "../../core/settings.ts";
import type { SpeechResult, VoicesResult } from "../main/speech.ts";
import type { LibraryData } from "../../core/pcg/catalog.ts";
import type { Snapshot } from "../../core/pcg/snapshots.ts";
import type { SyncState } from "../../core/device/syncstate.ts";

// The main process passes the e2e flag as an argument, because the sandboxed preload cannot read the environment.
const api: KronosApi = {
  e2e: process.argv.includes("--kronos-e2e"),
  e2eEffectsUnknown: process.argv.find((a) => a.startsWith("--kronos-effects-unknown="))?.slice(25) ?? "",
  e2eVariationsSeed: Number(process.argv.find((a) => a.startsWith("--kronos-e2e-variations-seed="))?.split("=")[1] ?? NaN) >>> 0 || null,
  e2eBareSim: process.argv.includes("--kronos-e2e-bare-sim"),
  open: () => ipcRenderer.invoke("kronos:open") as Promise<OpenedFile | null>,
  confirmOpen: () => ipcRenderer.invoke("kronos:confirm-open"),
  forgetPath: () => ipcRenderer.invoke("kronos:forget-path"),
  midiOpen: () => ipcRenderer.invoke("kronos:midi-open") as Promise<OpenedFile | null>,
  midiSearch: (site: SiteId, query: string) => ipcRenderer.invoke("kronos:midi-search", site, query) as Promise<MidiHit[]>,
  midiDownload: (site: SiteId, ref: string, title: string) => ipcRenderer.invoke("kronos:midi-download", site, ref, title) as Promise<string>,
  midiLibraryList: () => ipcRenderer.invoke("kronos:midi-library-list") as Promise<MidiLibraryEntry[]>,
  midiLibraryRead: (name: string) => ipcRenderer.invoke("kronos:midi-library-read", name) as Promise<Uint8Array>,
  midiLibraryDelete: (name: string) => ipcRenderer.invoke("kronos:midi-library-delete", name) as Promise<void>,
  midiLibraryImport: () => ipcRenderer.invoke("kronos:midi-library-import") as Promise<string | null>,
  playlistLoad: () => ipcRenderer.invoke("kronos:playlist-load") as Promise<string[]>,
  playlistSave: (items) => ipcRenderer.invoke("kronos:playlist-save", items) as Promise<void>,
  midiRecordMax: () => ipcRenderer.invoke("kronos:midi-record-max") as Promise<number>,
  midiSaveTake: (bytes: Uint8Array) => ipcRenderer.invoke("kronos:midi-save-take", bytes) as Promise<string>,
  compareOpen: () => ipcRenderer.invoke("kronos:compare-open") as Promise<OpenedFile | null>,
  saveAs: (bytes) => ipcRenderer.invoke("kronos:save-as", bytes) as Promise<string | null>,
  bankToolsExport: (format, content) => ipcRenderer.invoke("kronos:bank-tools-export", format, content) as Promise<string | null>,
  exchangeSave: (content) => ipcRenderer.invoke("kronos:exchange-save", content) as Promise<string | null>,
  exchangeOpen: () => ipcRenderer.invoke("kronos:exchange-open") as Promise<OpenedFile | null>,
  save: (bytes) => ipcRenderer.invoke("kronos:save", bytes) as Promise<string>,
  writeBackup: (name, bytes) => ipcRenderer.invoke("kronos:write-backup", name, bytes) as Promise<string>,
  backupBegin: (name) => ipcRenderer.invoke("kronos:backup-begin", name) as Promise<string>,
  backupWrite: (folder, files: BackupFile[]) => ipcRenderer.invoke("kronos:backup-write", folder, files) as Promise<Record<string, string>>,
  backupList: () => ipcRenderer.invoke("kronos:backup-list"),
  backupVerify: (name) => ipcRenderer.invoke("kronos:backup-verify", name),
  backupOpen: (name) => ipcRenderer.invoke("kronos:backup-open", name),
  backupReveal: (name) => ipcRenderer.invoke("kronos:backup-reveal", name),
  backupDelete: (name) => ipcRenderer.invoke("kronos:backup-delete", name),
  onCloseRequest: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("kronos:close-request", listener);
    return () => {
      ipcRenderer.removeListener("kronos:close-request", listener);
    };
  },
  confirmClose: () => ipcRenderer.invoke("kronos:confirm-close"),
  recoveryWrite: (docId, bytes) => ipcRenderer.invoke("kronos:recovery-write", docId, bytes) as Promise<void>,
  recoveryClear: (docId) => ipcRenderer.invoke("kronos:recovery-clear", docId) as Promise<void>,
  recoveryPeek: () => ipcRenderer.invoke("kronos:recovery-peek") as Promise<Uint8Array | null>,
  pullCacheSave: (bytes) => ipcRenderer.invoke("kronos:pull-cache-save", bytes) as Promise<void>,
  pullCacheLoad: () => ipcRenderer.invoke("kronos:pull-cache-load") as Promise<{ bytes: Uint8Array; savedAt: number } | null>,
  recoveryDiscard: () => ipcRenderer.invoke("kronos:recovery-discard") as Promise<void>,
  recoveryInterval: () => ipcRenderer.invoke("kronos:recovery-interval") as Promise<number>,
  copyText: (text: string) => ipcRenderer.invoke("kronos:copy-text", text) as Promise<void>,
  soundLibraryLoad: () => ipcRenderer.invoke("kronos:sound-library-load") as Promise<{ data: LibraryData; corrupt: boolean }>,
  soundLibrarySave: (data: LibraryData) => ipcRenderer.invoke("kronos:sound-library-save", data) as Promise<void>,
  settingsGet: () => ipcRenderer.invoke("kronos:settings-get") as Promise<Settings>,
  settingsSet: (patch) => ipcRenderer.invoke("kronos:settings-set", patch) as Promise<Settings>,
  snapshotsLoad: (name, engine) => ipcRenderer.invoke("kronos:snapshots-load", name, engine) as Promise<Snapshot[]>,
  snapshotsSave: (name, engine, list) => ipcRenderer.invoke("kronos:snapshots-save", name, engine, list) as Promise<void>,
  aiChat: (messages: Message[], tools: ToolDef[], route?: AiRoute) => ipcRenderer.invoke("kronos:ai-chat", messages, tools, route) as Promise<ChatReply>,
  aiCancel: () => ipcRenderer.invoke("kronos:ai-cancel") as Promise<void>,
  aiProviderStatus: (id) => ipcRenderer.invoke("kronos:ai-provider-status", id) as Promise<ProviderStatus>,
  aiTest: (id) => ipcRenderer.invoke("kronos:ai-test", id) as Promise<TestResult>,
  aiLocalReady: () => ipcRenderer.invoke("kronos:ai-local-ready") as Promise<boolean>,
  speechSynthesize: (req) => ipcRenderer.invoke("kronos:speech-synthesize", req) as Promise<SpeechResult>,
  openLink: (url) => ipcRenderer.invoke("kronos:open-link", url) as Promise<boolean>,
  speechCancel: () => ipcRenderer.invoke("kronos:speech-cancel") as Promise<void>,
  speechVoices: () => ipcRenderer.invoke("kronos:speech-voices") as Promise<VoicesResult>,
  secretsSet: (name, value) => ipcRenderer.invoke("kronos:secrets-set", name, value) as Promise<{ ok: true } | { ok: false; error: string }>,
  secretsClear: (name) => ipcRenderer.invoke("kronos:secrets-clear", name) as Promise<boolean>,
  secretsHas: (name) => ipcRenderer.invoke("kronos:secrets-has", name) as Promise<boolean>,
  aiCacheGet: (key: string) => ipcRenderer.invoke("kronos:ai-cache-get", key) as Promise<string | null>,
  aiCachePut: (key: string, text: string) => ipcRenderer.invoke("kronos:ai-cache-put", key, text) as Promise<boolean>,
  aiCacheClear: () => ipcRenderer.invoke("kronos:ai-cache-clear") as Promise<boolean>,
  aiCacheStats: () => ipcRenderer.invoke("kronos:ai-cache-stats") as Promise<{ count: number; bytes: number }>,
  aiRunLog: (row: unknown) => ipcRenderer.invoke("kronos:ai-run-log", row) as Promise<void>,
  aiUsageLog: (row: AiUsageRow) => ipcRenderer.invoke("kronos:ai-usage-log", row) as Promise<void>,
  syncStateGet: () => ipcRenderer.invoke("kronos:sync-state-get") as Promise<SyncState>,
  syncStateSet: (state: SyncState) => ipcRenderer.invoke("kronos:sync-state-set", state) as Promise<void>,
  recent: () => ipcRenderer.invoke("kronos:recent") as Promise<RecentState>,
  recentOpen: (id: string) => ipcRenderer.invoke("kronos:recent-open", id) as Promise<OpenedFile>,
  reopenLast: () => ipcRenderer.invoke("kronos:reopen-last") as Promise<OpenedFile | null>,
  clearCache: () => ipcRenderer.invoke("kronos:clear-cache") as Promise<void>,
  setReopenLast: (on: boolean) => ipcRenderer.invoke("kronos:set-reopen-last", on),
};

contextBridge.exposeInMainWorld("kronos", api);
