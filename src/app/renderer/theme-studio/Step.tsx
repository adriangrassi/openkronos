// A 56 px minus or plus beside a parameter's number field, for a thumb that cannot hit a 1-unit spinner. It commits through the row's own onCommit, so history, live edit and clamping behave as typing the number does.
export function Step({ k, name, dir, value, min, max, onCommit }: { k: string; name: string; dir: -1 | 1; value: number; min: number; max: number; onCommit: (text: string) => void }) {
  const next = Math.min(max, Math.max(min, value + dir));
  return (
    <button type="button" className="studio-step" data-testid={`step-${dir < 0 ? "down" : "up"}-${k}`} aria-label={`${dir < 0 ? "Decrease" : "Increase"} ${name}`} disabled={next === value} onClick={() => onCommit(String(next))}>
      {dir < 0 ? "−" : "+"}
    </button>
  );
}
