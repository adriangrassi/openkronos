import { COFFEE_URL, REPO_URL } from "../../core/links.ts";

// GitHub's own mark (Octicons "mark-github", MIT licensed).
const MARK = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

const CUP = "M2 4h9v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4zm9 1h1.5a1.5 1.5 0 0 1 0 3H11V5zM2 13.5h9V15H2v-1.5zM4 0h1.2v2.4H4V0zm2.8 0H8v2.4H6.8V0z";

export function CoffeeCup({ size }: { size: number }) {
  return <svg className="cup-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d={CUP} /></svg>;
}

export function GithubMark({ size }: { size: number }) {
  return <svg className="gh-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d={MARK} /></svg>;
}

// "hero" is the big pair on the start page, "compact" the pair at the right of the top bar.
// The coffee button shows only while COFFEE_URL is set. The main process opens only the listed pages.
export function SupportLinks({ variant }: { variant: "hero" | "compact" }) {
  const open = (u: string) => { void window.kronos.openLink(u); };
  const hero = variant === "hero";
  return (
    <span className={`support-links ${variant}`}>
      <button className="gh-star primary" data-testid="support-star" title="Star us on GitHub: opens the project page, then press Star" aria-label="Star us on GitHub" onClick={() => open(REPO_URL)}>
        <GithubMark size={hero ? 30 : 16} />{hero ? "Star us on GitHub" : <span className="lbl">Star</span>}
      </button>
      {COFFEE_URL !== "" && <button className="coffee" data-testid="support-coffee" title="Support the project with a coffee" onClick={() => open(COFFEE_URL)}><CoffeeCup size={hero ? 24 : 16} />Buy Me a Coffee</button>}
    </span>
  );
}
