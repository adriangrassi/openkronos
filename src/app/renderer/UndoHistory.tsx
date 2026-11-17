// Undo History panel: one row per undo step, newest first. Clicking row N undoes N steps, so the state right after that step returns.
interface Props {
  labels: string[];
  onUndoTo: (steps: number) => void;
}

export function UndoHistory({ labels, onUndoTo }: Props) {
  return (
    <section className="shell-pop shell-history" aria-label="Undo History" data-testid="shell-history">
      <h2>Undo History</h2>
      {labels.length === 0 ? (
        <p className="shell-note">Nothing to undo yet.</p>
      ) : (
        <ol className="shell-list">
          {labels.map((label, n) => (
            <li key={`${n}-${label}`}>
              <button data-testid={`shell-history-item-${n}`} title="Go back to just after this step" onClick={() => onUndoTo(n)}>
                {label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
