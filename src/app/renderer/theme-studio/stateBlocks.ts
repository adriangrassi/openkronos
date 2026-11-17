// The Studio top area shows state as colour blocks. Only states the app really knows are produced: nothing here is guessed.
export type Tone = "ok" | "warn" | "idle";
export interface StateBlock {
  id: "unsaved" | "differs";
  tone: Tone;
  title: string;
  sub: string;
}

export interface StateInput {
  unsaved: number; // changes since the file was opened or saved
  fileName: string;
  differs: boolean | null; // the last Check keyboard result for the open sound, null before one has run
}

export function stateBlocks({ unsaved, fileName, differs }: StateInput): StateBlock[] {
  const file = fileName || "the open file";
  const blocks: StateBlock[] = [
    unsaved > 0
      ? { id: "unsaved", tone: "warn", title: unsaved === 1 ? "1 unsaved change" : `${unsaved} unsaved changes`, sub: `Not saved to ${file}` }
      : { id: "unsaved", tone: "idle", title: "No unsaved changes", sub: `Saved to ${file}` },
  ];
  if (differs !== null) {
    blocks.push(
      differs
        ? { id: "differs", tone: "warn", title: "Differs from keyboard", sub: "Result of the last Check keyboard" }
        : { id: "differs", tone: "ok", title: "Matches keyboard", sub: "Result of the last Check keyboard" },
    );
  }
  return blocks;
}
