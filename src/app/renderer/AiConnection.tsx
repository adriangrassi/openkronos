import { useEffect, useState } from "react";
import { CARDS, CHIP_LABEL, chipOf, PROVIDER_IDS, type ProviderId, type ProviderStatus, type TestResult } from "../../core/ai/connect.ts";
import { CLAUDE_MODELS, type ClaudeModel, type Settings } from "../../core/settings.ts";
import guide from "../../../docs/AI-SETUP.md?raw";
import { Prose } from "./AiProse.tsx";

const MODEL_LABEL: Record<ClaudeModel, string> = {
  sonnet: "Sonnet: balanced (default)",
  haiku: "Haiku: fastest, lightest on your limits",
  opus: "Opus: strongest, uses your limits fastest",
};

type Props = { s: Settings; set: (patch: Partial<Settings>) => void; localKey: boolean };

// The "AI connection" part of Settings: one card per way of reaching a model. OpenKronos never starts a sign-in for you; the card shows the commands to run in a terminal.
export function AiConnection({ s, set, localKey }: Props) {
  const [status, setStatus] = useState<Partial<Record<ProviderId, ProviderStatus>>>({});
  const [busy, setBusy] = useState<Partial<Record<ProviderId, "check" | "test">>>({});
  const [result, setResult] = useState<Partial<Record<ProviderId, TestResult>>>({});
  const [copied, setCopied] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [urlText, setUrlText] = useState(s.aiBaseUrl);
  const [modelText, setModelText] = useState(s.aiModel);
  useEffect(() => { setUrlText(s.aiBaseUrl); setModelText(s.aiModel); }, [s.aiBaseUrl, s.aiModel]);

  const check = (id: ProviderId) => {
    setBusy((b) => ({ ...b, [id]: "check" }));
    void window.kronos.aiProviderStatus(id)
      .then((r) => setStatus((m) => ({ ...m, [id]: r })))
      .catch(() => setStatus((m) => ({ ...m, [id]: { installed: false, signedIn: "unknown", detail: "The check could not run." } })))
      .finally(() => setBusy((b) => ({ ...b, [id]: undefined })));
  };
  const test = (id: ProviderId) => {
    setBusy((b) => ({ ...b, [id]: "test" }));
    setResult((m) => ({ ...m, [id]: undefined }));
    void window.kronos.aiTest(id)
      .then((r) => {
        setResult((m) => ({ ...m, [id]: r }));
        if (r.ok) setStatus((m) => ({ ...m, [id]: { ...m[id], installed: true, signedIn: true, detail: m[id]?.detail ?? "A test call worked." } }));
      })
      .catch(() => setResult((m) => ({ ...m, [id]: { ok: false, kind: "failed", message: "The test could not run." } })))
      .finally(() => setBusy((b) => ({ ...b, [id]: undefined })));
  };
  const copy = (key: string, text: string) => {
    void window.kronos.copyText(text).then(() => { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1500); }).catch(() => {});
  };

  return (
    <section className="conn" data-testid="ai-conn-section" aria-label="AI connection">
      <h3>AI connection</h3>
      <p className="settings-hint">OpenKronos uses your own plan. Pick the one you have, check it, and press Use this one.</p>
      {PROVIDER_IDS.map((id) => {
        const card = CARDS[id];
        const st = status[id] ?? null;
        const chip = chipOf(st);
        const res = result[id];
        return (
          <div key={id} className="conn-card" data-testid={`ai-conn-card-${id}`} role="group" aria-label={card.title}>
            <div className="conn-head">
              <label className="conn-use">
                <input type="radio" name="ai-conn-use" data-testid={`ai-conn-use-${id}`} checked={s.aiProvider === id} onChange={() => set({ aiProvider: id })} />
                <b>{card.title}</b>
              </label>
              <span className="conn-chip" data-chip={chip} data-testid={`ai-conn-chip-${id}`}>{CHIP_LABEL[chip]}</span>
            </div>
            <p className="conn-what">{card.what}</p>
            {st && <p className="settings-hint" data-testid={`ai-conn-detail-${id}`}>{st.detail}{st.version ? ` (version ${st.version})` : ""}</p>}
            <div className="settings-btns">
              <button data-testid={`ai-conn-check-${id}`} disabled={!!busy[id]} onClick={() => check(id)}>{busy[id] === "check" ? "Checking..." : "Check"}</button>
              <button data-testid={`ai-conn-test-${id}`} disabled={!!busy[id]} title="One tiny real request, to see that it works end to end (20 seconds at most)" onClick={() => test(id)}>{busy[id] === "test" ? "Testing..." : "Test connection"}</button>
            </div>
            {res && <p className="conn-result" data-ok={res.ok} data-testid={`ai-conn-result-${id}`} role="status">{res.ok ? `It works: answered in ${(res.ms / 1000).toFixed(1)} s.` : res.message}</p>}
            {chip !== "ready" && (
              <ol className="conn-steps" data-testid={`ai-conn-steps-${id}`}>
                {card.steps.map((step, i) => (
                  <li key={i}>
                    {step.text}
                    {step.commands?.map((c, j) => {
                      const key = `${id}-${i}-${j}`;
                      return (
                        <div className="conn-cmd" key={key}>
                          <span className="settings-hint">{c.label}</span>
                          <code>{c.command}</code>
                          <button data-testid={`ai-conn-copy-${key}`} aria-label={`Copy: ${c.command}`} onClick={() => copy(key, c.command)}>{copied === key ? "Copied" : "Copy"}</button>
                        </div>
                      );
                    })}
                  </li>
                ))}
              </ol>
            )}
            {card.docs.length > 0 && <p className="settings-hint">Official instructions: {card.docs.map((d) => <span key={d.url} className="conn-doc">{d.label}: <code>{d.url}</code> </span>)}</p>}
            {id === "claude" && (
              <div className="settings-row"><span>Claude model</span>
                <select data-testid="ai-conn-model" aria-label="Claude model" value={s.aiClaudeModel} onChange={(e) => set({ aiClaudeModel: CLAUDE_MODELS.find((m) => m === e.target.value) ?? "sonnet" })}>
                  {CLAUDE_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
                </select>
              </div>
            )}
            {id === "local" && (
              <>
                <p className="settings-hint" data-testid="ai-conn-local-key">{localKey ? "AUTOROUTER_KEY is set." : "AUTOROUTER_KEY is not set, so this option is off."} The address must be this computer or a machine on your network.</p>
                <div className="settings-row"><span>Local router address</span>
                  <input data-testid="settings-ai-url" aria-label="Local router base URL" value={urlText} onChange={(e) => setUrlText(e.target.value)} onBlur={() => set({ aiBaseUrl: urlText })} />
                </div>
                <div className="settings-row"><span>Local model id</span>
                  <input data-testid="settings-ai-model" aria-label="Local model id" value={modelText} onChange={(e) => setModelText(e.target.value)} onBlur={() => set({ aiModel: modelText })} />
                </div>
              </>
            )}
          </div>
        );
      })}
      <p className="settings-hint" data-testid="ai-conn-privacy">Privacy: nothing is sent until you use an AI feature, then only your question and the open sound's data go to the provider you chose. OpenKronos never reads, stores or logs your sign-in. Saved answers stay on this computer.</p>
      <div className="settings-btns">
        <button data-testid="ai-conn-guide" aria-expanded={showGuide} onClick={() => setShowGuide((v) => !v)}>{showGuide ? "Hide setup guide" : "Setup guide"}</button>
      </div>
      {showGuide && <div className="conn-guide" data-testid="ai-conn-guide-text"><Prose text={guide} /></div>}
    </section>
  );
}
