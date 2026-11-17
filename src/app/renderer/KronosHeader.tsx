// The header of the Play page: bank, engine badge, tempo, the sound's number and name on the LCD bar, Favorite. Items without data are left out.
import type { Row } from "../../core/params/params.ts";
import { nameTag } from "../../core/pages/mixer.ts";
import { Badge, Toggle, ValueBox, type CtlProps } from "./KronosControls.tsx";

type Props = {
  bank: string;
  index: number;
  name: string;
  engine?: string;
  tempo?: { r: Row; value: number; fmt: (v: number) => string; onCommit: (t: string) => void };
  favorite?: CtlProps;
  // The selected timbre, Combination only.
  line?: string;
  // Pages other than Play: the name sits in a slim box, as on the keyboard.
  slim?: boolean;
};

export function KronosHeader({ bank, index, name, engine, tempo, favorite, line, slim }: Props) {
  return (
    <div className={`kh${slim ? " kh-slim" : ""}`} data-testid="kronos-header">
      <div className="kh-top">
        <span className="kh-field kh-bank" data-testid="kh-bank"><b>Bank:</b> {bank}</span>
        {engine && <Badge tone="red">{engine}</Badge>}
        {tempo && (
          <span className="kh-field kh-tempo"><b aria-hidden="true">&#9833; =</b> <ValueBox r={tempo.r} value={tempo.value} fmt={tempo.fmt} onCommit={tempo.onCommit} /></span>
        )}
        {favorite && !slim && <span className="kh-fav"><Toggle {...favorite} label="Favorite" /></span>}
      </div>
      <div className="kh-lcd" data-testid="kh-name">{nameTag(index, name)}</div>
      {line && <div className="kh-line" data-testid="kh-line">{line}</div>}
    </div>
  );
}
