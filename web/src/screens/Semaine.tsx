import type { BudgetReport, Deadline, Doc, FamilleReport, Household } from "../types";
import { pointSemaine, type PointSemaine, type SemaineEntree } from "../../../server/src/semaine";
import { Back, Logo, Noeud } from "../ui";

/** Same inputs as the server's Sunday email (server/src/hebdo.ts), from the data the app already has. */
export function entreeSemaine(household: Household, deadlines: Deadline[], docs: Doc[], budget: BudgetReport | null, famille: FamilleReport | null): SemaineEntree {
  const geste = budget?.actions.find((a) => a.decision !== "garde" && a.decision !== "resilie") ?? null;
  return {
    foyer: household.nom,
    echeances: deadlines.map((d) => ({ id: d.id, titre: d.titre, date: d.date, fait: d.fait, note: d.note, document_id: d.document_id })),
    creneaux: famille?.semaine ?? [],
    aVerifier: docs.filter((d) => !d.verifie && (d.confiance ?? 1) < 0.7).length,
    economies: budget && budget.nb_transactions && household.plan === "famille"
      ? { possibles: budget.economies_possibles, decidees: budget.economies_decidees, geste: geste ? { titre: geste.titre, effort: geste.effort, gain: geste.economie_annuelle } : null }
      : null,
    conseils: famille?.conseils ?? [],
  };
}

export const calculerSemaine = (...a: Parameters<typeof entreeSemaine>): PointSemaine => pointSemaine(entreeSemaine(...a));

const ICONES: Record<string, string> = {
  echeances: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4",
  agenda: "M12 8v4l3 2M12 21a9 9 0 110-18 9 9 0 010 18z",
  budget: "M3 20h18M6 16V9M11 16V5M16 16v-7M21 16v-4",
  papiers: "M4 4h10l6 6v10H4zM14 4v6h6M8 13h8M8 17h5",
  conseil: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z",
};

export function Semaine({ point, household, go, onBack }: { point: PointSemaine; household: Household; go: (s: string, id?: string) => void; onBack: () => void }) {
  const prenom = household.utilisateur?.prenom && household.utilisateur.prenom !== "Moi" ? ` ${household.utilisateur.prenom}` : "";
  const ouvrir = (route: string | null) => { if (!route) return; const [s, id] = route.split("/"); go(s, id); };
  return (
    <div className="screen semaine">
      <Back onClick={onBack} />
      <div className="lettre">
        <div className="lettre-tete"><Logo /><span>{periode(point.du, point.au)}</span></div>
        <h1 className="detail-title">{point.titre}</h1>
        <p className="lettre-intro">Bonjour{prenom},<br />{point.intro}</p>
      </div>

      {point.sections.map((s) => (
        <section className="section" key={s.cle}>
          <div className="section-head"><h2><svg className="sec-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONES[s.cle]} /></svg>{s.titre}</h2></div>
          <ul className="list">
            {s.items.map((i, k) => (
              <li key={k}>
                <button className="row-item semaine-item" onClick={() => ouvrir(i.route)}>
                  {s.cle === "echeances" && i.quand
                    ? <div className={`date-chip ${i.urgent ? "late" : "soon"}`}><b>{new Date(i.quand + "T00:00:00").getDate()}</b><span>{new Date(i.quand + "T00:00:00").toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span></div>
                    : s.cle === "agenda" ? <div className="date-chip"><b style={{ fontSize: 15 }}>{i.titre.slice(0, 3)}</b></div>
                    : <div className="cat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONES[s.cle]} /></svg></div>}
                  <div>
                    <div className="t">{s.cle === "agenda" ? `${i.titre} ${new Date(i.quand + "T00:00:00").getDate()}` : i.titre}</div>
                    {i.detail && <div className="s">{i.detail}</div>}
                  </div>
                  <div className="r">{i.montant ? <span className="semaine-gain">{Math.round(i.montant).toLocaleString("fr-FR")} €<small>/ an</small></span> : null}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="lettre-signature">Lucien, votre majordome</p>
      <p className="note" style={{ textAlign: "center", marginTop: 6 }}>{household.hebdo === false ? "Le point du dimanche est arrêté." : `Ce point vous arrive aussi chaque dimanche soir${household.plan === "famille" ? ", par notification et par email" : ", par notification"}.`} <button className="link" onClick={() => go("settings")}>Réglages</button></p>
    </div>
  );
}

/** « 2 → 8 novembre », « 30 nov. → 6 déc. » */
function periode(du: string, au: string) {
  const d = new Date(du + "T00:00:00"), a = new Date(au + "T00:00:00");
  const mois = (x: Date, court: boolean) => x.toLocaleDateString("fr-FR", { month: court ? "short" : "long" });
  return d.getMonth() === a.getMonth() ? `${d.getDate()} → ${a.getDate()} ${mois(a, false)}` : `${d.getDate()} ${mois(d, true)} → ${a.getDate()} ${mois(a, true)}`;
}

/** Small entry card on the home screen. */
export function SemaineCarte({ point, go }: { point: PointSemaine; go: (s: string) => void }) {
  return (
    <button className="semaine-carte" onClick={() => go("semaine")}>
      <span className="semaine-carte-noeud" aria-hidden><Noeud /></span>
      <span className="semaine-carte-txt"><b>Votre semaine avec Lucien</b><span>{point.vide ? "Rien d'urgent. Je veille." : point.notification.corps}</span></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
    </button>
  );
}
