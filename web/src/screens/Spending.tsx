import { useRef, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { BudgetAction, BudgetReport, Household } from "../types";
import { fmtEuro } from "../ui";
import { BankLink } from "./BankLink";

const TYPE_LABEL: Record<BudgetAction["type"], string> = {
  fantome: "Abonnement fantôme", hausse: "Hausse silencieuse", sans_contrat: "Contrat à ajouter", contrat_sans_prelevement: "Contrat sans prélèvement",
  frais: "Frais bancaires", derive: "Dérive ce mois-ci", doublon: "Doublon", timing: "À faire avant",
};

export function Spending({ api, budget, household, go, onChanged, onUpgrade, toast }: {
  api: Api; budget: BudgetReport | null; household: Household; go: (s: string, id?: string) => void; onChanged: () => void; onUpgrade: () => void; toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [texte, setTexte] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  const doImport = async (input: { file?: File; texte?: string; demo?: boolean }) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.importStatement(input);
      toast(r.ajoutees ? `${r.ajoutees} opérations importées` : "Rien de nouveau : opérations déjà connues");
      setShowImport(false); setTexte("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "L'import a échoué. Vérifiez le fichier (CSV de votre banque).");
    } finally { setBusy(false); }
  };

  const decide = async (a: BudgetAction, decision: "garde" | "resilie") => {
    await api.decide(a.cle, decision);
    toast(decision === "resilie" ? `${fmtEuro(a.economie_annuelle)} par an d'économie prévue` : "Noté, on n'en reparle plus");
    onChanged();
  };

  // Free plan (after the trial): no statement import and no bank link; what was imported during the trial stays visible.
  const importOk = household.plan !== "gratuit";
  const importLock = (
    <div className="lock" style={{ marginTop: 0, marginBottom: 14 }}>
      <b>L'analyse des dépenses fait partie de la formule complète</b>
      <p>Connexion bancaire ou import de relevés : Lucien repère les abonnements fantômes, les hausses, les doublons et les frais évitables, et chiffre chaque économie.</p>
      <button className="btn" onClick={onUpgrade}>Découvrir la formule complète</button>
    </div>
  );

  if (!budget || budget.nb_transactions === 0) {
    return (
      <section className="section">
        <div className="section-head"><h2>Dépenses réelles</h2></div>
        {importOk ? (
          <>
            <BankLink api={api} household={household} onChanged={onChanged} onUpgrade={onUpgrade} toast={toast} />
            <div className="lock" style={{ marginTop: 0 }}>
              <b>Ou importez un relevé</b>
              <p>Export CSV de votre banque, PDF ou lignes collées. Lucien repère les abonnements fantômes, les hausses, les doublons et les frais évitables.</p>
              <ImportBox busy={busy} err={err} texte={texte} setTexte={setTexte} pick={pick} onFile={(f) => doImport({ file: f })} onText={() => doImport({ texte })} onDemo={() => doImport({ demo: true })} />
            </div>
          </>
        ) : importLock}
      </section>
    );
  }

  const open = budget.actions.filter((a) => a.decision !== "garde" && a.decision !== "resilie");
  const done = budget.actions.filter((a) => a.decision === "resilie");
  const hidden = budget.actions_total - budget.actions.length;

  return (
    <>
      <section className="section">
        <div className="section-head"><h2>Dépenses réelles</h2>{importOk && <button className="link" onClick={() => setShowImport(!showImport)}>Importer un relevé</button>}</div>
        {importOk ? <BankLink api={api} household={household} onChanged={onChanged} onUpgrade={onUpgrade} toast={toast} compact /> : importLock}
        {importOk && showImport && (
          <div className="lock" style={{ marginTop: 0, marginBottom: 14 }}>
            <ImportBox busy={busy} err={err} texte={texte} setTexte={setTexte} pick={pick} onFile={(f) => doImport({ file: f })} onText={() => doImport({ texte })} onDemo={api.mode === "demo" ? () => doImport({ demo: true }) : undefined} />
          </div>
        )}
        <div className="strip" style={{ marginBottom: 16 }}>
          <button onClick={() => {}}><b>{fmtEuro(budget.depenses_mois_courant)}</b><span>dépensé ce mois-ci</span></button>
          <button onClick={() => {}}><b>{fmtEuro(budget.depenses_moyenne_mensuelle)}</b><span>moyenne mensuelle</span></button>
          <button onClick={() => {}}><b>{fmtEuro(budget.reste_a_vivre_moyen)}</b><span>reste chaque mois</span></button>
        </div>
        <p className="note">{budget.nb_transactions} opérations sur {budget.periode.mois} mois · revenus moyens {fmtEuro(budget.revenus_moyenne_mensuelle)} / mois</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Économies faciles</h2>
          {budget.economies_possibles > 0 && <span className="badge">{fmtEuro(budget.economies_possibles)} / an</span>}
        </div>
        {budget.economies_decidees > 0 && (
          <div className="confidence ok" style={{ display: "flex", width: "100%" }}>Déjà décidé : {fmtEuro(budget.economies_decidees)} par an économisés grâce à {done.length} résiliation{done.length > 1 ? "s" : ""}.</div>
        )}
        {open.length === 0 ? <p className="note">{importOk ? "Rien à signaler pour le moment. Importez le prochain relevé le mois prochain." : "Rien à signaler sur les opérations importées pendant votre essai."}</p> : (
          <div>
            {open.map((a) => (
              <div className={`alert ${a.priorite === 1 ? "important" : a.priorite === 2 ? "attention" : ""}`} key={a.cle}>
                <i />
                <div>
                  <div className="s" style={{ marginBottom: 2 }}>{TYPE_LABEL[a.type]} · {a.effort}</div>
                  <div className="t">{a.titre}</div>
                  <div className="d">{a.detail}</div>
                  <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                    {(a.type === "fantome" || a.type === "doublon") && <button className="link" onClick={() => decide(a, "resilie")}>Je résilie</button>}
                    {a.type === "hausse" && a.document_id && <button className="link" onClick={() => go("doc", a.document_id!)}>Courrier de résiliation</button>}
                    {a.type === "hausse" && !a.document_id && <button className="link" onClick={() => decide(a, "resilie")}>Je renégocie</button>}
                    {a.type === "sans_contrat" && <button className="link" onClick={() => go("add")}>Ajouter le contrat</button>}
                    {a.type === "contrat_sans_prelevement" && a.document_id && <button className="link" onClick={() => go("doc", a.document_id!)}>Voir le contrat</button>}
                    {a.type === "frais" && <button className="link" onClick={() => decide(a, "resilie")}>Je négocie</button>}
                    <button className="link" style={{ color: "var(--mist)" }} onClick={() => decide(a, "garde")}>Je garde</button>
                  </div>
                </div>
                {a.economie_annuelle > 0 ? <div className="save">{fmtEuro(a.economie_annuelle)}<small>{a.type === "derive" ? "ce mois" : "/ an"}</small></div> : <span />}
              </div>
            ))}
          </div>
        )}
        {budget.apercu && hidden > 0 && (
          <div className="lock">
            <b>{hidden} autre{hidden > 1 ? "s" : ""} économie{hidden > 1 ? "s" : ""} repérée{hidden > 1 ? "s" : ""}</b>
            <p>La formule complète affiche toute la liste, triée par euros gagnés et par effort.</p>
            <button className="btn" onClick={onUpgrade}>Découvrir la formule complète</button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Ce mois-ci par poste</h2></div>
        <ul className="list">
          {budget.par_categorie.slice(0, 8).map((c) => (
            <li key={c.categorie} className="row-item" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <div className="t">{c.libelle}</div>
                <div className="s">moyenne {fmtEuro(c.moyenne)}{c.variation !== null && Math.abs(c.variation) >= 0.1 ? ` · ${c.variation > 0 ? "+" : ""}${Math.round(c.variation * 100)} %` : ""}</div>
              </div>
              <div className="r" style={{ color: c.variation !== null && c.variation >= 0.25 ? "var(--ember)" : undefined }}>{fmtEuro(c.mois_courant)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section-head"><h2>Prélèvements récurrents</h2><span className="badge">{fmtEuro(budget.recurrences.reduce((s, r) => s + r.mensuel_equivalent, 0))} / mois</span></div>
        <ul className="list">
          {budget.recurrences.map((r) => (
            <li key={r.cle} className="row-item" style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <div className="t" style={{ textTransform: "capitalize" }}>{r.marchand}</div>
                <div className="s">{r.jour_du_mois ? `le ${r.jour_du_mois} du mois · ` : ""}{r.contrat_id ? <button className="link" style={{ fontSize: 13 }} onClick={() => go("doc", r.contrat_id!)}>contrat connu</button> : "aucun contrat dans Lucien"}</div>
              </div>
              <div className="r">{fmtEuro(r.mensuel_equivalent)}<small>/ mois</small></div>
            </li>
          ))}
        </ul>
      </section>

    </>
  );
}

function ImportBox({ busy, err, texte, setTexte, pick, onFile, onText, onDemo }: {
  busy: boolean; err: string | null; texte: string; setTexte: (s: string) => void; pick: React.RefObject<HTMLInputElement>;
  onFile: (f: File) => void; onText: () => void; onDemo?: () => void;
}) {
  return (
    <div>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={busy} onClick={() => pick.current?.click()}>{busy ? <span className="spinner" /> : "Choisir un relevé"}</button>
        {onDemo && <button className="btn ghost" disabled={busy} onClick={onDemo}>Essayer avec un exemple</button>}
      </div>
      <input ref={pick} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <textarea className="ta" style={{ minHeight: 90 }} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={"ou collez des lignes : 12/10/2026 CB CARREFOUR -54,30"} />
      {texte.trim() && <div style={{ marginTop: 8 }}><button className="btn ghost block" disabled={busy} onClick={onText}>Importer ces lignes</button></div>}
      {err && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>{err}</p>}
      <p className="note" style={{ marginTop: 8 }}>Les opérations restent dans votre coffre ; le connecteur IA n'y accède pas tant que vous n'activez pas le périmètre « banque ».</p>
    </div>
  );
}
