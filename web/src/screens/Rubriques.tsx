import { useState } from "react";
import type { BudgetReport, ChargesReport, Deadline, Doc, FamilleReport, Household } from "../types";
import { fmtEuro } from "../ui";

/**
 * The home grid: each rubrique is a tile, and every person keeps the ones they use. Removing a tile erases nothing:
 * the screen is still there (tab bar, « Ajouter »), only the shortcut goes. The choice is kept on the device.
 */
type Teinte = "a" | "b" | "c" | "d";
export interface Contexte { household: Household; docs: Doc[]; deadlines: Deadline[]; charges: ChargesReport | null; budget: BudgetReport | null; famille?: FamilleReport | null }
interface Rubrique {
  id: string; nom: string; phrase: string; icone: string; teinte: Teinte;
  aller?: (c: Contexte) => [string, string?] | null; // null: not for this household (no teenager…)
  sous?: (c: Contexte) => string | null;
  bientot?: boolean;
}

const ado = (c: Contexte) => (c.famille?.membres ?? []).filter((m) => m.role === "enfant" && (m.age ?? 0) >= 6).sort((x, y) => (y.age ?? 0) - (x.age ?? 0))[0];
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export const RUBRIQUES: Rubrique[] = [
  { id: "papiers", nom: "Papiers", phrase: "Tout ce que vous avez rangé, à retrouver d'un mot", teinte: "a", icone: "M4 4h10l6 6v10H4zM14 4v6h6M8 13h8M8 17h5", aller: () => ["docs"], sous: (c) => (c.docs.length ? pluriel(c.docs.length, "rangé", "rangés") : "Ajoutez le premier") },
  { id: "agenda", nom: "Agenda", phrase: "Les échéances et les activités de chacun", teinte: "b", icone: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 14l2 2 4-4", aller: () => ["deadlines"], sous: (c) => (c.deadlines.length ? `${c.deadlines.length} à venir` : "Rien à venir") },
  { id: "budget", nom: "Budget", phrase: "Vos dépenses et les économies faciles", teinte: "c", icone: "M3 20h18M6 16V9M11 16V5M16 16v-7M21 16v-4", aller: () => ["budget"], sous: (c) => (c.charges?.total_mensuel ? `${fmtEuro(c.charges.total_mensuel)} / mois` : null) },
  { id: "famille", nom: "Famille", phrase: "La page de chaque personne du foyer", teinte: "d", icone: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9", aller: () => ["famille"], sous: (c) => (c.famille?.membres.length ? pluriel(c.famille.membres.length, "personne", "personnes") : null) },
  { id: "semaine", nom: "Ma semaine", phrase: "Le point de la semaine : échéances, agenda, le geste qui rapporte", teinte: "b", icone: "M4 6h16M4 12h16M4 18h10", aller: () => ["semaine"] },
  { id: "poche", nom: "Argent de poche", phrase: "La cagnotte des enfants, leurs objectifs et leurs missions", teinte: "c", icone: "M12 21a9 9 0 100-18 9 9 0 000 18zM15 9.5a3.5 3.5 0 100 5M8 11h5M8 13.5h5", aller: (c) => { const m = ado(c); return m ? ["poche", m.id] : null; }, sous: (c) => ado(c)?.prenom ?? null },
  { id: "dossiers", nom: "Dossiers", phrase: "Location, prêt, passeport : les pièces rassemblées", teinte: "a", icone: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z", aller: () => ["dossiers"] },
  { id: "urgence", nom: "Coup dur", phrase: "Portefeuille perdu, dégât des eaux, accident : quoi faire, dans l'ordre", teinte: "a", icone: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z", aller: () => ["urgence"] },
  { id: "situations", nom: "Grands moments", phrase: "Déménagement, naissance, mariage : chaque démarche à la bonne date", teinte: "d", icone: "M4 19h16M6 15l4-4 3 3 5-6", aller: () => ["situations"] },
  { id: "partages", nom: "Dépenses partagées", phrase: "Qui a payé quoi, et qui doit combien", teinte: "c", icone: "M7 7h13l-3-3M17 17H4l3 3", aller: () => ["partages"] },
  { id: "budget_expert", nom: "Budget expert", phrase: "Résultat, bilan, prévisionnel, ratios", teinte: "c", icone: "M4 19V9M10 19V5M16 19v-7M22 19H2", aller: () => ["espace", "budget"] },
  { id: "pro", nom: "Vie pro", phrase: "Bulletins de salaire, revenus d'activité, 2035", teinte: "b", icone: "M3 8h18v12H3zM8 8V5a1 1 0 011-1h6a1 1 0 011 1v3M3 13h18", aller: () => ["espace", "pro"] },
  { id: "locatif", nom: "Locatif", phrase: "Loyers, quittances, révision, impôts", teinte: "d", icone: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5", aller: () => ["espace", "locatif"] },
  { id: "connecteur", nom: "Mon IA", phrase: "Claude ou ChatGPT consultent vos papiers, si vous l'autorisez", teinte: "b", icone: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z", aller: () => ["connecteur"] },
  { id: "courses", nom: "Liste de courses", phrase: "Partagée avec la famille", teinte: "a", icone: "M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z", bientot: true },
  { id: "agenda_perso", nom: "Mon agenda perso", phrase: "Google, Apple ou Outlook dans Lucien", teinte: "b", icone: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4", bientot: true },
];

const CLE = "lucien.rubriques";
const PAR_DEFAUT = ["papiers", "agenda", "budget", "famille", "semaine", "poche", "dossiers", "urgence"];
function lire(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CLE) ?? "null"); if (Array.isArray(v)) return v.filter((x) => typeof x === "string"); } catch { /* storage refused */ }
  return PAR_DEFAUT;
}
const garder = (l: string[]) => { try { localStorage.setItem(CLE, JSON.stringify(l)); } catch { /* storage refused */ } };

const Icone = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

export function Rubriques({ go, ...c }: Contexte & { go: (s: string, id?: string) => void }) {
  const [choix, setChoix] = useState<string[]>(lire);
  const [mode, setMode] = useState<"voir" | "ranger" | "ajouter">("voir");
  const poser = (l: string[]) => { setChoix(l); garder(l); };
  const possibles = RUBRIQUES.filter((r) => !r.bientot && r.aller?.(c));
  const miennes = choix.map((id) => possibles.find((r) => r.id === id)).filter((r): r is Rubrique => !!r);
  const autres = RUBRIQUES.filter((r) => r.bientot || (possibles.includes(r) && !choix.includes(r.id)));
  const bouger = (id: string, pas: number) => {
    const ids = miennes.map((r) => r.id); const i = ids.indexOf(id); const j = i + pas;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; poser(ids);
  };

  if (mode === "ajouter") return (
    <section className="rubriques" aria-label="Ajouter une rubrique">
      <div className="rub-tete"><b>Ajouter une rubrique</b><button className="link" onClick={() => setMode("voir")}>Terminé</button></div>
      {autres.filter((r) => !r.bientot).length === 0 && <p className="note" style={{ marginBottom: 10 }}>Toutes les rubriques sont déjà sur votre accueil.</p>}
      <ul className="rub-catalogue">
        {autres.map((r) => (
          <li key={r.id}>
            <span className={`rub-ico ${r.teinte}`}><Icone d={r.icone} /></span>
            <span className="rub-txt"><b>{r.nom}</b><small>{r.phrase}</small></span>
            {r.bientot ? <span className="rub-bientot">Bientôt</span> : <button className="btn" onClick={() => poser([...miennes.map((x) => x.id), r.id])}>Ajouter</button>}
          </li>
        ))}
      </ul>
    </section>
  );

  const ranger = mode === "ranger";
  return (
    <section className="rubriques" aria-label="Mes rubriques">
      <div className="rub-tete"><b>Mes rubriques</b><button className="link" onClick={() => setMode(ranger ? "voir" : "ranger")}>{ranger ? "Terminé" : "Personnaliser"}</button></div>
      {ranger && <p className="note" style={{ margin: "0 2px 12px" }}>Gardez ce qui vous sert. Une rubrique retirée n'efface rien : elle revient par « Ajouter ».</p>}
      <div className={`rub-grille${ranger ? " ranger" : ""}`}>
        {miennes.map((r, i) => {
          const sous = r.sous?.(c);
          return ranger ? (
            <div key={r.id} className="rub-tuile">
              <button className="rub-x" aria-label={`Retirer ${r.nom}`} onClick={() => poser(miennes.filter((x) => x.id !== r.id).map((x) => x.id))}>×</button>
              <span className={`rub-ico ${r.teinte}`}><Icone d={r.icone} /></span>
              <b>{r.nom}</b>
              <span className="rub-fleches">
                <button aria-label={`Avancer ${r.nom}`} disabled={i === 0} onClick={() => bouger(r.id, -1)}>‹</button>
                <button aria-label={`Reculer ${r.nom}`} disabled={i === miennes.length - 1} onClick={() => bouger(r.id, 1)}>›</button>
              </span>
            </div>
          ) : (
            <button key={r.id} className="rub-tuile" onClick={() => { const a = r.aller!(c)!; go(a[0], a[1]); }}>
              <span className={`rub-ico ${r.teinte}`}><Icone d={r.icone} /></span>
              <b>{r.nom}</b>{sous && <small>{sous}</small>}
            </button>
          );
        })}
        <button className="rub-tuile plus" onClick={() => setMode("ajouter")}><span className="rub-ico"><Icone d="M12 5v14M5 12h14" /></span><b>Ajouter</b></button>
      </div>
    </section>
  );
}
