import { Bell } from "../notifications";
import type { BudgetReport, ChargesReport, Deadline, Doc, FamilleReport, Household } from "../types";
import { DateChip, daysUntil, fmtDate, fmtEuro, relative } from "../ui";

export function Today({ household, deadlines, docs, charges, budget, go, onDone, unread, famille }: {
  household: Household; deadlines: Deadline[]; docs: Doc[]; charges: ChargesReport | null; budget: BudgetReport | null;
  go: (s: string, id?: string) => void; onDone: (id: string) => void; unread: number; famille?: FamilleReport | null;
}) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const cejour = (famille?.semaine ?? []).filter((s) => s.jour === todayIdx && s.type !== "cantine");
  const next = deadlines[0];
  const soon = deadlines.filter((d) => daysUntil(d.date) <= 45);
  const toVerify = docs.filter((d) => !d.verifie && (d.confiance ?? 1) < 0.7);
  const savings = (budget?.economies_possibles ?? 0) + (budget?.nb_transactions ? 0 : (charges?.alertes.reduce((s, a) => s + (a.economie_estimee ?? 0), 0) ?? 0));
  const best = budget?.actions.find((a) => a.decision !== "garde" && a.decision !== "resilie") ?? null;
  const parEmail = docs.filter((d) => d.source === "email" && Date.now() - new Date(d.cree_le).getTime() < 7 * 864e5).length;
  const hour = new Date().getHours();
  const hello = hour < 18 ? "Coucou" : "Bonsoir";

  return (
    <div className="screen">
      <div className="top">
        <div>
          <h1>{hello}</h1>
          <p className="sub">{household.nom}</p>
        </div>
        <div className="top-actions"><Bell unread={unread} onClick={() => go("notifs")} /><button className="bell" aria-label="Réglages" onClick={() => go("settings")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg></button></div>
      </div>

      {household.essai?.actif && (household.essai.jours_restants ?? 0) > 2 && (
        <div className="confidence ok" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14 }}>
          <span>Plan Famille complet offert : encore {household.essai.jours_restants} jour{(household.essai.jours_restants ?? 0) > 1 ? "s" : ""}</span>
          <button className="link" onClick={() => go("settings")}>Garder</button>
        </div>
      )}
      {household.essai?.actif && (household.essai.jours_restants ?? 0) <= 2 && (
        <div className="confidence" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14, gap: 10 }}>
          <span>{(household.essai.jours_restants ?? 0) <= 1 ? "Dernier jour" : `Plus que ${household.essai.jours_restants} jours`} de plan Famille offert{savings > 0 ? ` : ${fmtEuro(savings)} par an d'économies repérées` : ""}. Ensuite, lecture IA et dépenses en pause.</span>
          <button className="btn" style={{ minHeight: 36, padding: "6px 12px", flex: "0 0 auto" }} onClick={() => go("settings")}>Garder</button>
        </div>
      )}
      {household.essai && !household.essai.actif && household.plan === "gratuit" && (budget?.economies_possibles ?? 0) > 0 && (
        <div className="confidence" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14 }}>
          <span>Votre essai est terminé : {fmtEuro(budget!.economies_possibles)} par an d'économies attendent dans le plan Famille.</span>
          <button className="link" onClick={() => go("settings")}>Voir</button>
        </div>
      )}
      {parEmail > 0 && (
        <div className="confidence ok" style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 14 }}>
          <span>{parEmail} papier{parEmail > 1 ? "s" : ""} arrivé{parEmail > 1 ? "s" : ""} par email cette semaine, rangé{parEmail > 1 ? "s" : ""} tout seul{parEmail > 1 ? "s" : ""}.</span>
          <button className="link" onClick={() => go("docs")}>Voir</button>
        </div>
      )}
      {household.essai?.actif && (docs.length === 0 || !budget?.nb_transactions || household.membres.length < 2) && (
        <section className="section steps" aria-label="Vos premiers gestes">
          <div className="section-head"><h2>Votre nid en 3 gestes</h2><span className="badge">{[docs.length > 0, !!budget?.nb_transactions, household.membres.length >= 2].filter(Boolean).length}/3</span></div>
          <ol>
            <li className={docs.length > 0 ? "done" : ""}><button onClick={() => go("add")}><i /><div><b>Photographiez un papier</b><span>30 secondes : il se range et crée ses rappels tout seul</span></div></button></li>
            <li className={budget?.nb_transactions ? "done" : ""}><button onClick={() => go("budget")}><i /><div><b>Connectez votre banque</b><span>1 minute : Nidou chiffre vos économies faciles</span></div></button></li>
            <li className={household.membres.length >= 2 ? "done" : ""}><button onClick={() => go("settings")}><i /><div><b>Ajoutez votre conjoint</b><span>les papiers et les rappels se partagent</span></div></button></li>
          </ol>
        </section>
      )}
      {next ? (
        <section className={`nest ${daysUntil(next.date) > 30 ? "calm" : ""}`} aria-label="Prochaine échéance">
          <p className="kicker">Prochaine échéance</p>
          <div className="count">
            <b>{Math.max(0, daysUntil(next.date))}</b>
            <span>{daysUntil(next.date) === 1 ? "jour" : "jours"} · {fmtDate(next.date, { day: "numeric", month: "long" })}</span>
          </div>
          <p className="what">{next.titre}</p>
          {next.note && <p className="why">{next.note}</p>}
          <div className="row">
            {next.document_id && <button className="btn light" onClick={() => go("doc", next.document_id!)}>Voir le document</button>}
            <button className="btn light" onClick={() => onDone(next.id)}>C'est fait</button>
          </div>
        </section>
      ) : (
        <section className="nest calm">
          <p className="kicker">Rien à l'horizon</p>
          <p className="what">Ajoutez un premier papier : Nidou repère les dates et crée les rappels.</p>
          <div className="row"><button className="btn light" onClick={() => go("add")}>Ajouter un papier</button></div>
        </section>
      )}

      {(famille && (famille.membres.length > 1 || cejour.length > 0)) && (
        <section className="section">
          <div className="section-head"><h2>La famille aujourd'hui</h2><button className="link" onClick={() => go("famille")}>Famille</button></div>
          {cejour.length === 0 ? (
            <p className="note">Rien de prévu aujourd'hui pour {famille.composition.enfants ? "les enfants" : "la famille"}. {famille.conseils.length ? `${famille.conseils.length} conseils vous attendent.` : ""}</p>
          ) : cejour.map((s, i) => (
            <div key={i} className="slot" style={{ padding: "6px 0" }}><span className="h">{s.heure_debut ?? "—"}</span><span className="w"><b>{s.titre}</b>{s.membre ? ` · ${s.membre}` : ""}{s.lieu ? <small>{s.lieu}</small> : null}</span></div>
          ))}
        </section>
      )}
      <div className="strip">
        <button onClick={() => go("deadlines")}><b>{soon.length}</b><span>échéances proches</span></button>
        <button onClick={() => go("budget")}><b>{charges ? fmtEuro(charges.total_mensuel) : "—"}</b><span>charges fixes par mois</span></button>
        <button onClick={() => go("budget")}><b>{savings ? fmtEuro(savings) : "—"}</b><span>économies par an</span></button>
      </div>

      {toVerify.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>À vérifier</h2><span className="badge yolk">{toVerify.length}</span></div>
          <ul className="list">
            {toVerify.slice(0, 3).map((d) => (
              <li key={d.id}>
                <button className="row-item" onClick={() => go("doc", d.id)}>
                  <DateChip iso={d.date_document ?? d.cree_le.slice(0, 10)} />
                  <div><div className="t">{d.title}</div><div className="s">Extraction incertaine : confirmez les dates et le montant</div></div>
                  <div className="r">›</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Les prochaines semaines</h2><button onClick={() => go("deadlines")}>Tout voir</button></div>
        {soon.length <= 1 ? (
          <p className="note">Rien d'autre avant 45 jours.</p>
        ) : (
          <ul className="list">
            {soon.slice(1, 6).map((d) => (
              <li key={d.id}>
                <button className="row-item" onClick={() => d.document_id && go("doc", d.document_id)}>
                  <DateChip iso={d.date} />
                  <div><div className="t">{d.titre}</div><div className="s">{relative(d.date)}</div></div>
                  <div className="r">›</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {best ? (
        <section className="section">
          <div className="section-head"><h2>Économie facile</h2><button onClick={() => go("budget")}>Toutes</button></div>
          <div className={`alert ${best.priorite === 1 ? "important" : "attention"}`}>
            <i />
            <div><div className="t">{best.titre}</div><div className="d">{best.detail}</div></div>
            {best.economie_annuelle ? <div className="save">{fmtEuro(best.economie_annuelle)}<small>{best.type === "derive" ? "ce mois" : "/ an"}</small></div> : <span />}
          </div>
          {budget && budget.economies_decidees > 0 && <p className="note" style={{ marginTop: 8 }}>Déjà {fmtEuro(budget.economies_decidees)} par an économisés grâce à vos décisions.</p>}
        </section>
      ) : charges && charges.alertes[0] && (
        <section className="section">
          <div className="section-head"><h2>Économie repérée</h2><button onClick={() => go("budget")}>Budget</button></div>
          <div className={`alert ${charges.alertes[0].gravite}`}>
            <i />
            <div><div className="t">{charges.alertes[0].titre}</div><div className="d">{charges.alertes[0].detail}</div></div>
            {charges.alertes[0].economie_estimee ? <div className="save">{fmtEuro(charges.alertes[0].economie_estimee)}<small>/ an</small></div> : <span />}
          </div>
        </section>
      )}
    </div>
  );
}
