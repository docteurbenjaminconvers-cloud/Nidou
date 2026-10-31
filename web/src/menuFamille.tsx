import { createContext, useContext, useEffect, useState } from "react";
import type { Api } from "./api";
import type { FamilleReport, Household } from "./types";
import { Portrait } from "./screens/Famille";

type Ctx = { api: Api; famille: FamilleReport | null; household: Household; go: (s: string, id?: string) => void };
export const FamilleCtx = createContext<Ctx | null>(null);

const ORDRE = { adulte: 0, enfant: 1, parent_a_charge: 2, autre_a_charge: 3 } as const;
const ROLE = { adulte: "Adulte", enfant: "Enfant", parent_a_charge: "Parent à charge", autre_a_charge: "Proche à charge" } as const;

/** The signed-in person's face, next to the bell: tap to unfold the whole family, one tap more to open someone's page. */
export function MenuFamille() {
  const ctx = useContext(FamilleCtx);
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    if (!ouvert) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    const h = () => setOuvert(false);
    addEventListener("keydown", k); addEventListener("hashchange", h);
    return () => { removeEventListener("keydown", k); removeEventListener("hashchange", h); };
  }, [ouvert]);
  if (!ctx?.famille || ctx.famille.membres.length === 0) return null;
  const { api, famille, household, go } = ctx;
  const membres = [...famille.membres].sort((a, b) => ORDRE[a.role] - ORDRE[b.role] || (b.age ?? 0) - (a.age ?? 0));
  const p = (household.utilisateur?.prenom ?? "").trim().toLowerCase();
  const moi = membres.find((m) => p && m.prenom.toLowerCase() === p) ?? membres.find((m) => m.prenom === "Moi") ?? membres.find((m) => m.role === "adulte") ?? membres[0];
  const ouvrir = (id?: string) => { setOuvert(false); go("famille", id); };

  return (
    <span className="menu-famille">
      <button className="moi-btn" aria-label="Ma famille" aria-expanded={ouvert} aria-haspopup="menu" onClick={() => setOuvert(!ouvert)}>
        <Portrait api={api} m={moi} size={44} />
      </button>
      {ouvert && (
        <>
          <div className="mf-fond" onClick={() => setOuvert(false)} aria-hidden />
          <div className="mf-panneau" role="menu" aria-label="Ma famille">
            <button role="menuitem" className="mf-ligne mf-tous" onClick={() => ouvrir()}>
              <span className="mf-tetes" aria-hidden>{membres.slice(0, 4).map((m) => <Portrait key={m.id} api={api} m={m} size={22} />)}</span>
              <span><b>Toute la famille</b><small>La semaine, les dates clés, les conseils</small></span>
            </button>
            {membres.map((m) => (
              <button role="menuitem" key={m.id} className="mf-ligne" onClick={() => ouvrir(m.id)}>
                <Portrait api={api} m={m} size={40} />
                <span><b>{m.prenom}{m.id === moi.id && m.prenom !== "Moi" ? " (moi)" : ""}</b><small>{[m.age !== null ? `${m.age} ans` : null, m.classe ?? (m.role === "adulte" || m.role === "enfant" ? null : ROLE[m.role])].filter(Boolean).join(" · ") || ROLE[m.role]}</small></span>
                <svg className="mf-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
              </button>
            ))}
            <button role="menuitem" className="mf-ligne mf-ajout" onClick={() => ouvrir()}>
              <span className="portrait plus" style={{ width: 40, height: 40 }} aria-hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
              <span><b>Ajouter quelqu'un</b></span>
            </button>
          </div>
        </>
      )}
    </span>
  );
}
