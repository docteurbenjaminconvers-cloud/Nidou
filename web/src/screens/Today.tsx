import { Bell } from "../notifications";
import type { BudgetReport, ChargesReport, Deadline, Doc, FamilleReport, Household } from "../types";
import { DateChip, daysUntil, fmtEuro, Logo, relative } from "../ui";
import { RemarquesCarte } from "./Remarques";
import { Rubriques } from "./Rubriques";
import type { Api } from "../api";

export function Today({ api, household, deadlines, docs, charges, budget, go, onDone, unread, famille }: {
  api: Api; household: Household; deadlines: Deadline[]; docs: Doc[]; charges: ChargesReport | null; budget: BudgetReport | null;
  go: (s: string, id?: string) => void; onDone: (id: string) => void; unread: number; famille?: FamilleReport | null;
}) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const cejour = (famille?.semaine ?? []).filter((s) => s.jour === todayIdx && s.type !== "cantine");
  const next = deadlines[0];
  const soon = deadlines.filter((d) => daysUntil(d.date) <= 45);
  const toVerify = docs.filter((d) => !d.verifie && (d.confiance ?? 1) < 0.7);
  const savings = (budget?.economies_possibles ?? 0) + (budget?.nb_transactions ? 0 : (charges?.alertes.reduce((s, a) => s + (a.economie_estimee ?? 0), 0) ?? 0));
  const best = budget?.actions.find((a) => a.decision !== "garde" && a.decision !== "resilie") ?? null;
  const hour = new Date().getHours();
  const hello = hour < 18 ? "Coucou" : "Bonsoir";
  // Living alone is a first-class case: the third first step is the email inbox, not "add your partner".
  const seul = (famille?.situation ?? household.situation) === "seul" && (famille?.membres.length ?? 1) <= 1;
  const etape3 = seul ? docs.some((d) => d.source === "email") : household.membres.length >= 2;

  const aFaire = soon.slice(0, 3);
  return (
    <div className="screen accueil">
      <div className="top">
        <div>
          <div className="home-brand"><Logo /></div>
          <h1>{hello}</h1>
          <p className="sub">{household.nom}</p>
        </div>
        <div className="top-actions"><Bell unread={unread} onClick={() => go("notifs")} /><button className="bell" aria-label="Réglages" onClick={() => go("settings")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg></button></div>
      </div>

      <button className="ask grand" onClick={() => go("assistant")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
        <span>Demander à Lucien</span><small>« Où est mon contrat d'assurance ? »</small>
      </button>

      {household.essai?.actif && (household.essai.jours_restants ?? 0) > 2 && (
        <div className="confidence ok" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14 }}>
          <span>Formule complète offerte : encore {household.essai.jours_restants} jour{(household.essai.jours_restants ?? 0) > 1 ? "s" : ""}</span>
          <button className="link" onClick={() => go("settings")}>Garder</button>
        </div>
      )}
      {household.essai?.actif && (household.essai.jours_restants ?? 0) <= 2 && (
        <div className="confidence" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14, gap: 10 }}>
          <span>{(household.essai.jours_restants ?? 0) <= 1 ? "Dernier jour" : `Plus que ${household.essai.jours_restants} jours`} de formule complète offerte{savings > 0 ? ` : ${fmtEuro(savings)} par an d'économies repérées` : ""}. Ensuite, lecture IA et dépenses en pause.</span>
          <button className="btn" style={{ minHeight: 36, padding: "6px 12px", flex: "0 0 auto" }} onClick={() => go("settings")}>Garder</button>
        </div>
      )}
      {household.essai && !household.essai.actif && household.plan === "gratuit" && (budget?.economies_possibles ?? 0) > 0 && (
        <div className="confidence" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14 }}>
          <span>Votre essai est terminé : {fmtEuro(budget!.economies_possibles)} par an d'économies attendent dans la formule complète.</span>
          <button className="link" onClick={() => go("settings")}>Voir</button>
        </div>
      )}
      {household.essai?.actif && (docs.length === 0 || !budget?.nb_transactions || !etape3) && (
        <section className="section steps" aria-label="Vos premiers gestes">
          <div className="section-head"><h2>Votre foyer en 3 gestes</h2><span className="badge">{[docs.length > 0, !!budget?.nb_transactions, etape3].filter(Boolean).length}/3</span></div>
          <ol>
            <li className={docs.length > 0 ? "done" : ""}><button onClick={() => go("add")}><i /><div><b>Photographiez un papier</b><span>30 secondes : il se range et crée ses rappels tout seul</span></div></button></li>
            <li className={budget?.nb_transactions ? "done" : ""}><button onClick={() => go("budget")}><i /><div><b>Connectez votre banque</b><span>1 minute : Lucien chiffre vos économies faciles</span></div></button></li>
            {seul
              ? <li className={etape3 ? "done" : ""}><button onClick={() => go("settings")}><i /><div><b>Transférez une facture par email</b><span>votre adresse Lucien : les papiers arrivent rangés</span></div></button></li>
              : <li className={etape3 ? "done" : ""}><button onClick={() => go("settings")}><i /><div><b>Ajoutez votre conjoint</b><span>les papiers et les rappels se partagent</span></div></button></li>}
          </ol>
        </section>
      )}

      <section className="section a-faire">
        <div className="section-head"><h2>À faire</h2><button onClick={() => go("deadlines")}>Tout voir</button></div>
        {aFaire.length === 0 && toVerify.length === 0 && cejour.length === 0 ? (
          <p className="note">{next ? `Rien avant 45 jours. Prochaine échéance : ${next.titre}, ${relative(next.date)}.` : "Rien à l'horizon. Ajoutez un papier : Lucien repère les dates et crée les rappels."}</p>
        ) : (
          <ul className="list">
            {aFaire.map((d) => (
              <li key={d.id} className="af-ligne">
                <button className="row-item" onClick={() => (d.document_id ? go("doc", d.document_id) : go("deadlines"))}>
                  <DateChip iso={d.date} />
                  <div><div className="t">{d.titre}</div><div className="s">{relative(d.date)}</div></div>
                </button>
                <button className="af-fait" aria-label={`${d.titre} : c'est fait`} onClick={() => onDone(d.id)}>Fait</button>
              </li>
            ))}
            {toVerify.length > 0 && (
              <li>
                <button className="row-item" onClick={() => go("doc", toVerify[0].id)}>
                  <span className="af-pastille" aria-hidden>?</span>
                  <div><div className="t">{toVerify.length > 1 ? `${toVerify.length} papiers à vérifier` : `À vérifier : ${toVerify[0].title}`}</div><div className="s">Lecture incertaine : confirmez les dates et le montant</div></div>
                  <div className="r">›</div>
                </button>
              </li>
            )}
            {cejour.length > 0 && (
              <li>
                <button className="row-item" onClick={() => go("famille")}>
                  <span className="af-pastille jour" aria-hidden>{cejour.length}</span>
                  <div><div className="t">Aujourd'hui : {cejour.slice(0, 2).map((s) => `${s.titre}${s.heure_debut ? ` à ${s.heure_debut}` : ""}`).join(", ")}{cejour.length > 2 ? "…" : ""}</div><div className="s">La journée de la famille</div></div>
                  <div className="r">›</div>
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {best && (
        <button className="eco-ligne" onClick={() => go("budget")}>
          <span><b>Économie facile</b>{best.titre}</span>
          {best.economie_annuelle ? <em>{fmtEuro(best.economie_annuelle)}<small>{best.type === "derive" ? " ce mois" : " / an"}</small></em> : <em>›</em>}
        </button>
      )}

      <Rubriques household={household} docs={docs} deadlines={deadlines} charges={charges} budget={budget} famille={famille} go={go} />

      <RemarquesCarte api={api} go={go} />
    </div>
  );
}

