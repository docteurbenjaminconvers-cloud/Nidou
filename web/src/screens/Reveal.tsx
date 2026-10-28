import { useEffect, useState } from "react";
import type { BudgetReport } from "../types";
import { fmtEuro } from "../ui";

export const REVEAL_KEY = "nidou.revelation.vue";

/**
 * The "wow" moment of the trial: shown once, right after the first bank connection or statement import.
 * A counter climbs to the yearly savings found, then the three biggest actions appear one by one.
 */
export function Reveal({ budget, onClose, go, toast }: { budget: BudgetReport; onClose: () => void; go: (s: string, id?: string) => void; toast: (m: string) => void }) {
  const total = budget.economies_possibles;
  const top = budget.actions.filter((a) => a.economie_annuelle > 0 && a.type !== "derive").slice(0, 3);
  const [n, setN] = useState(0);
  const [step, setStep] = useState(0); // 0 analysing, 1 counting, 2 list, 3 done

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 1400);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (step !== 1) return;
    const start = performance.now(), dur = 1800;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(total * eased));
      if (p < 1) raf = requestAnimationFrame(tick); else setTimeout(() => setStep(2), 300);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, total]);

  useEffect(() => { if (step === 2) { const t = setTimeout(() => setStep(3), 400 + top.length * 350); return () => clearTimeout(t); } }, [step, top.length]);

  const share = async () => {
    const text = `Nidou vient de trouver ${fmtEuro(total)} par an d'économies cachées dans mes prélèvements, en 1 minute. Essai gratuit 15 jours : https://nidou.fr`;
    try {
      if (navigator.share) await navigator.share({ title: "Nidou", text });
      else { await navigator.clipboard.writeText(text); toast("Message copié, à coller où vous voulez"); }
    } catch {}
  };

  return (
    <div className="reveal" role="dialog" aria-label="Vos économies" aria-live="polite">
      <div className="reveal-inner">
        {step === 0 && (
          <div className="reveal-analyse">
            <span className="spinner big" />
            <p>Nidou analyse {budget.nb_transactions} opérations sur {budget.periode.mois} mois…</p>
            <small>abonnements, hausses, doublons, frais</small>
          </div>
        )}
        {step >= 1 && (
          <>
            <p className="reveal-kicker">Économies faciles trouvées</p>
            <div className="reveal-amount"><b>{fmtEuro(n)}</b><span>par an</span></div>
            <p className="reveal-sub">{step >= 2 ? `soit ${fmtEuro(Math.round(total / 12))} par mois, sans changer de vie` : " "}</p>
            <ul className="reveal-list">
              {step >= 2 && top.map((a, i) => (
                <li key={a.cle} style={{ animationDelay: `${i * 350}ms` }}>
                  <div><b>{a.titre}</b><span>{a.effort} · {a.type === "fantome" ? "abonnement fantôme" : a.type === "doublon" ? "doublon" : a.type === "hausse" ? "hausse silencieuse" : a.type === "frais" ? "frais évitables" : "à vérifier"}</span></div>
                  <em>{fmtEuro(a.economie_annuelle)}</em>
                </li>
              ))}
            </ul>
            {step >= 3 && (
              <div className="reveal-actions">
                <p className="reveal-more">{budget.actions_total > top.length ? `et ${budget.actions_total - top.length} autres pistes dans votre Budget. ` : ""}Nidou refait le tour à chaque nouvelle opération.</p>
                <button className="btn block" onClick={() => { onClose(); go("budget"); }}>Décider, en 2 minutes</button>
                <button className="btn light block" onClick={share}>Partager cette trouvaille</button>
                <button className="link" style={{ marginTop: 6 }} onClick={onClose}>Plus tard</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
