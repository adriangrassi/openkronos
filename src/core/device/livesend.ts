// One Live slot's way to the keyboard's edit buffer: single-parameter messages when the setting is on and the edit maps cleanly, the whole dump otherwise.
import { KronosError, type KronosClient } from "./client.ts";
import { planParamChanges, rowsForKind, type LiveKind } from "./paramSend.ts";
import { pushCurrent } from "./sync.ts";
import { getEntry, listBanks } from "../pcg/library.ts";
import type { PcgFile } from "../pcg/pcg.ts";
import type { ParamTables } from "../params/params.ts";

export type LiveSendOptions = {
  client: KronosClient;
  channel: number;
  key: string;
  index: number;
  tables: () => ParamTables | null;
  single: () => boolean;
};

export class LiveSender {
  private readonly o: LiveSendOptions;
  private device: Uint8Array | null = null; // what the keyboard's edit buffer is known to hold; null until a whole dump went out
  dumps = 0;
  params = 0;

  constructor(o: LiveSendOptions) {
    this.o = o;
  }

  // Call up of a slot: the next send is a whole dump.
  forget(): void {
    this.device = null;
  }

  // Sends the slot's newest bytes. Several edits that piled up while a send was in flight are diffed against what the keyboard holds, so none is lost.
  async send(file: PcgFile): Promise<void> {
    const { client, channel, key, index } = this.o;
    const info = listBanks(file).find((b) => b.key === key);
    const tables = this.o.tables();
    if (info && tables && this.device && this.o.single() && (info.kind === "combi" || info.kind === "program")) {
      const kind: LiveKind = info.kind === "combi" ? "combi" : info.type === "exi" ? "exi" : "hd1";
      const now = Uint8Array.from(getEntry(file, key, index).subarray(0, info.objectSize));
      const msgs = planParamChanges(channel, rowsForKind(tables, kind), this.device, now);
      if (msgs) {
        try {
          for (const m of msgs) {
            await client.sendParamChange(m);
            this.params++;
          }
          this.device = now;
          return;
        } catch (e) {
          // The keyboard refused a parameter: send the whole sound instead. Any other failure (no answer, closed) is reported as before.
          if (!(e instanceof KronosError)) throw e;
        }
      }
    }
    await pushCurrent(client, file, key, index);
    this.dumps++;
    this.device = info ? Uint8Array.from(getEntry(file, key, index).subarray(0, info.objectSize)) : null;
  }
}
