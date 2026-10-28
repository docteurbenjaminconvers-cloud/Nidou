import { Bell } from "../notifications";
import type { Api } from "../api";
import type { BudgetReport, ChargesReport, Household } from "../types";
import { Spending } from "./Spending";
import { CATEGORY_LABEL, type Category } from "../types";
import { CAT_COLORS, fmtEuro, CatIcon, PERIOD_LABEL } from "../ui";

export function Budget({ api, charges, budget, household, go, onUpgrade, onChanged, toast, unread }: { api: Api; charges: ChargesReport | null; budget: BudgetReport | null; household: Household; go: (s: string, id?: string) => void; onUpgrade: () => void; onChanged: () => void; toast: (m: string) => void; unread: number }) {
  if (!charges) return <div className="screen"><div className="top"><h1>Budget</h1></div><p className="note">Chargement…</p></div>;
  const savings = charges.alertes.reduce((s, a) => s + (a.economie_estimee ?? 0), 0);
  const hidden = charges.alertes_total - charges.alertes.length;

  return (
    <div className="screen">
      <div className="top"><div><h1>Budget</h1><p className="sub">Vos dépenses réelles et vos charges fixes, avec les économies à portée de main</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>

      <Spending api={api} budget={budget} household={household} go={go} onChanged={onChanged} onUpgrade={onUpgrade} toast={toast} />

      <div className="section-head" style={{ marginTop: 8 }}><h2>Charges fixes d'après vos papiers</h2></div>
      <p className="note" style={{ marginBottom: 12 }}>Reconstituées à partir de {charges.charges.length} contrats et abonnements enregistrés.</p>

      <div className="total">
        <b>{fmtEuro(charges.total_mensuel)}</b> <span>par mois · {fmtEuro(charges.total_annuel)} par an</span>
        <div className="bar" aria-hidden>
          {charges.par_categorie.map((c) => <i key={c.category} style={{ width: `${c.part * 100}%`, background: CAT_COLORS[c.category] }} />)}
        </div>
        <ul className="legend" style={{ padding: 0, margin: 0 }}>
          {charges.par_categorie.map((c) => (
            <li key={c.category}><i style={{ background: CAT_COLORS[c.category] }} />{CATEGORY_LABEL[c.category as Category]}<b>{fmtEuro(c.mensuel)}</b></li>
          ))}
        </ul>
      </div>

      <section className="section">
        <div className="section-head"><h2>Alertes sur les contrats</h2>{savings > 0 && <span className="badge">{fmtEuro(savings)} / an</span>}</div>
        {charges.alertes.length === 0 ? <p className="note">Rien à signaler : vos contrats sont à jour.</p> : (
          <div>
            {charges.alertes.map((a, i) => (
              <div className={`alert ${a.gravite}`} key={i}>
                <i />
                <div>
                  <div className="t">{a.titre}</div>
                  <div className="d">{a.detail}</div>
                  <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                    {a.document_ids.slice(0, 2).map((id) => <button key={id} className="link" onClick={() => go("doc", id)}>Voir le contrat</button>)}
                  </div>
                </div>
                {a.economie_estimee ? <div className="save">{fmtEuro(a.economie_estimee)}<small>/ an</small></div> : <span />}
              </div>
            ))}
          </div>
        )}
        {charges.apercu && hidden > 0 && (
          <div className="lock">
            <b>{hidden} autre{hidden > 1 ? "s" : ""} alerte{hidden > 1 ? "s" : ""} d'économie</b>
            <p>Le plan Famille affiche toutes les alertes : doublons, hausses de tarif, contrats jamais renégociés.</p>
            <button className="btn" onClick={onUpgrade}>Découvrir le plan Famille</button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Détail par contrat</h2></div>
        <ul className="list">
          {charges.charges.map((c) => (
            <li key={c.document_id}>
              <button className="row-item" onClick={() => go("doc", c.document_id)}>
                <CatIcon c={c.category as Category} />
                <div><div className="t">{c.titre}</div><div className="s">{c.organisme ?? CATEGORY_LABEL[c.category as Category]} · {fmtEuro(c.montant_periode, 2)} {PERIOD_LABEL[c.periodicite]}</div></div>
                <div className="r">{fmtEuro(c.montant_mensuel)}<small>/ mois</small></div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {household.plan === "gratuit" && <p className="note">Plan gratuit : aperçu. La connexion bancaire (rapprochement automatique avec vos prélèvements) arrivera avec le plan Famille.</p>}
    </div>
  );
}
