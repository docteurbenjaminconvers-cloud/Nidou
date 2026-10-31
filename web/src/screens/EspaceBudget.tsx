import { useState } from "react";
import type { Api } from "../api";
import { CHARGES, nomMois, POSTES, PRODUITS, type Actif, type Passif, type Poste } from "../../../server/src/budgetExpert";
import { Alertes, Champ, Chiffres, EnTete, eur, moisCourt, nouvelId, pct, telecharger, useEspace, Verrou } from "./espacesCommun";

const TYPES_ACTIF: Record<Actif["type"], string> = { compte: "Compte courant", epargne: "Épargne disponible", placement: "Placement", immobilier: "Immobilier", vehicule: "Véhicule", autre: "Autre" };
const TYPES_PASSIF: Record<Passif["type"], string> = { credit_immo: "Crédit immobilier", credit_conso: "Crédit à la consommation", autre: "Autre dette" };

/** Budget expert : compte de résultat, prévisionnel, bilan patrimonial, ratios, clôture, grand livre. */
export function EspaceBudget({ api, go, onBack, toast }: { api: Api; go: (s: string, id?: string) => void; onBack: () => void; toast: (m: string) => void }) {
  const { data, ferme, err, sauver } = useEspace(api, "budget");
  const [moisSel, setMoisSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Poste | null>(null);
  const [val, setVal] = useState("");
  const [ajout, setAjout] = useState<"actif" | "passif" | null>(null);
  const [ligne, setLigne] = useState({ libelle: "", type: "epargne", valeur: "", mensualite: "" });
  if (ferme) return <Verrou module={ferme} go={go} onBack={onBack} />;
  if (!data) return <div className="screen"><EnTete titre="Budget expert" sous="Chargement…" espace="budget" onBack={onBack} />{err && <p className="note">{err}</p>}</div>;
  const { rapport: r, donnees: d } = data;
  const m = r.mois.find((x) => x.mois === moisSel) ?? r.mois.filter((x) => x.complet).at(-1) ?? r.mois.at(-1)!;
  const maxBarre = Math.max(1, ...r.mois.map((x) => Math.max(x.total_produits, x.total_charges)));

  const enregistrerPrevu = async (p: Poste) => {
    const v = Number(val.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return toast("Montant invalide");
    await sauver({ ...d, previsionnel: { ...d.previsionnel, [p]: Math.round(v) } }); setEdit(null); toast("Prévisionnel enregistré");
  };
  const ajouterLigne = async () => {
    const v = Number(ligne.valeur.replace(",", "."));
    if (!ligne.libelle.trim() || !Number.isFinite(v)) return toast("Libellé et montant, s'il vous plaît");
    const pat = ajout === "actif"
      ? { ...d.patrimoine, actifs: [...d.patrimoine.actifs, { id: nouvelId(), libelle: ligne.libelle.trim(), type: ligne.type as Actif["type"], valeur: v }] }
      : { ...d.patrimoine, passifs: [...d.patrimoine.passifs, { id: nouvelId(), libelle: ligne.libelle.trim(), type: ligne.type as Passif["type"], capital_restant: v, mensualite: Number(ligne.mensualite.replace(",", ".")) || 0 }] };
    await sauver({ ...d, patrimoine: pat }); setAjout(null); setLigne({ libelle: "", type: "epargne", valeur: "", mensualite: "" });
  };
  const retirer = async (k: "actifs" | "passifs", id: string) => { await sauver({ ...d, patrimoine: { ...d.patrimoine, [k]: (d.patrimoine[k] as { id: string }[]).filter((x) => x.id !== id) } }); };
  const exclus = new Set(d.comptes_exclus ?? []);
  const basculerCompte = async (c: string) => { const s = new Set(exclus); if (s.has(c)) s.delete(c); else s.add(c); await sauver({ ...d, comptes_exclus: [...s] }); };

  return (
    <div className="screen espace">
      <EnTete titre="Budget expert" sous="Les comptes du foyer, tenus comme par un expert-comptable" espace="budget" onBack={onBack} />
      <Alertes alertes={r.alertes} />
      <Chiffres items={[
        { label: "reste chaque mois", valeur: eur(r.moyenne.resultat), ton: r.moyenne.resultat >= 0 ? "ok" : "alerte", detail: "moyenne sur 3 mois" },
        { label: "taux d'épargne", valeur: pct(r.ratios.taux_epargne), ton: (r.ratios.taux_epargne ?? 0) >= 10 ? "ok" : "neutre" },
        { label: "patrimoine net", valeur: eur(r.bilan.valeur_nette) },
        { label: "endettement", valeur: pct(r.ratios.endettement), ton: (r.ratios.endettement ?? 0) > 35 ? "alerte" : "ok", detail: "plafond bancaire 35 %" },
      ]} />

      <section className="section">
        <div className="section-head"><h2>Compte de résultat</h2><span className="badge">{nomMois(m.mois)}{m.complet ? "" : " · en cours"}</span></div>
        <div className="barres" role="group" aria-label="Choisir le mois">
          {r.mois.map((x) => (
            <button key={x.mois} className={`barre-mois ${x.mois === m.mois ? "sel" : ""}`} onClick={() => setMoisSel(x.mois)}>
              <span className="bm-col"><i className="p" style={{ height: `${(x.total_produits / maxBarre) * 100}%` }} /><i className="c" style={{ height: `${(x.total_charges / maxBarre) * 100}%` }} /></span>
              <small>{moisCourt(x.mois)}</small>
            </button>
          ))}
        </div>
        <div className="cr">
          <div className="cr-bloc"><div className="cr-titre"><span>Produits</span><b>{eur(m.total_produits)}</b></div>
            {PRODUITS.filter((p) => m.produits[p]).map((p) => <div className="cr-ligne" key={p}><em>{POSTES[p].compte}</em><span>{POSTES[p].libelle}</span><b>{eur(m.produits[p])}</b></div>)}
          </div>
          <div className="cr-bloc"><div className="cr-titre"><span>Charges</span><b>{eur(m.total_charges)}</b></div>
            {CHARGES.filter((p) => m.charges[p]).sort((a, b) => (m.charges[b] ?? 0) - (m.charges[a] ?? 0)).map((p) => <div className="cr-ligne" key={p}><em>{POSTES[p].compte}</em><span>{POSTES[p].libelle}</span><b>{eur(m.charges[p])}</b></div>)}
          </div>
          <div className={`cr-resultat ${m.resultat >= 0 ? "ok" : "alerte"}`}><span>Résultat du mois</span><b>{m.resultat >= 0 ? "+" : ""}{eur(m.resultat)}</b></div>
          {m.epargne_versee !== 0 && <div className="cr-ligne epargne"><em>512</em><span>Versé sur l'épargne</span><b>{eur(m.epargne_versee)}</b></div>}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Prévisionnel du mois</h2><span className="badge yolk">{nomMois(r.mois_courant)}</span></div>
        <p className="note" style={{ marginTop: -4 }}>Touchez un poste pour fixer votre budget. « Proposé » : Lucien a pris votre moyenne des 3 derniers mois.</p>
        <ul className="prevu">
          {r.previsionnel.map((p) => (
            <li key={p.poste} className={p.statut}>
              <button className="prevu-ligne" onClick={() => { setEdit(edit === p.poste ? null : p.poste); setVal(String(p.prevu)); }}>
                <span className="prevu-nom">{p.libelle}{p.propose && <i>proposé</i>}</span>
                <span className="prevu-montants"><b>{eur(p.mois_courant)}</b> / {eur(p.prevu)}</span>
                <span className="prevu-barre"><i style={{ width: `${Math.min(100, p.avancement)}%` }} /></span>
              </button>
              {edit === p.poste && (
                <div className="prevu-edit">
                  <input className="in" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enregistrerPrevu(p.poste)} autoFocus aria-label={`Budget ${p.libelle}`} />
                  <button className="btn" onClick={() => enregistrerPrevu(p.poste)}>Fixer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section-head"><h2>Bilan patrimonial</h2><span className="badge">{eur(r.bilan.valeur_nette)} net</span></div>
        <div className="bilan">
          <div className="bilan-col">
            <div className="bilan-tete"><span>Ce que vous possédez</span><b>{eur(r.bilan.total_actifs)}</b></div>
            {r.bilan.actifs.map((a) => <div className="bilan-ligne" key={a.id}><span>{a.libelle}<small>{TYPES_ACTIF[a.type]}</small></span><b>{eur(a.valeur)}</b><button aria-label={`Retirer ${a.libelle}`} onClick={() => retirer("actifs", a.id)}>×</button></div>)}
            <button className="link" onClick={() => { setAjout("actif"); setLigne({ ...ligne, type: "epargne" }); }}>Ajouter un bien ou un compte</button>
          </div>
          <div className="bilan-col passif">
            <div className="bilan-tete"><span>Ce que vous devez</span><b>{eur(r.bilan.total_passifs)}</b></div>
            {r.bilan.passifs.map((p) => <div className="bilan-ligne" key={p.id}><span>{p.libelle}<small>{TYPES_PASSIF[p.type]} · {eur(p.mensualite)}/mois</small></span><b>{eur(p.capital_restant)}</b><button aria-label={`Retirer ${p.libelle}`} onClick={() => retirer("passifs", p.id)}>×</button></div>)}
            <button className="link" onClick={() => { setAjout("passif"); setLigne({ ...ligne, type: "credit_immo" }); }}>Ajouter un crédit</button>
          </div>
        </div>
        {ajout && (
          <div className="lock form-espace">
            <Champ label="Libellé"><input className="in" value={ligne.libelle} onChange={(e) => setLigne({ ...ligne, libelle: e.target.value })} placeholder={ajout === "actif" ? "Livret A, maison, PEA…" : "Crédit immobilier, prêt auto…"} /></Champ>
            <Champ label="Type"><select className="in" value={ligne.type} onChange={(e) => setLigne({ ...ligne, type: e.target.value })}>{Object.entries(ajout === "actif" ? TYPES_ACTIF : TYPES_PASSIF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>
            <Champ label={ajout === "actif" ? "Valeur (€)" : "Capital restant dû (€)"}><input className="in" inputMode="decimal" value={ligne.valeur} onChange={(e) => setLigne({ ...ligne, valeur: e.target.value })} /></Champ>
            {ajout === "passif" && <Champ label="Mensualité (€)"><input className="in" inputMode="decimal" value={ligne.mensualite} onChange={(e) => setLigne({ ...ligne, mensualite: e.target.value })} /></Champ>}
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={ajouterLigne}>Ajouter</button><button className="btn ghost" onClick={() => setAjout(null)}>Annuler</button></div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Ratios</h2></div>
        <div className="ratios">
          <Jauge titre="Taux d'endettement" valeur={r.ratios.endettement} max={50} seuil={35} unite="%" texte="Mensualités de crédit sur revenus. Les banques plafonnent à 35 %, assurance comprise." inverse />
          <Jauge titre="Épargne de précaution" valeur={r.ratios.epargne_precaution_mois} max={12} seuil={3} unite="mois" texte="Liquidités disponibles, en mois de dépenses. Visez 3 à 6 mois." />
          <Jauge titre="Taux d'épargne" valeur={r.ratios.taux_epargne} max={40} seuil={10} unite="%" texte="Part des revenus qui reste en fin de mois." />
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Clôture de {nomMois(r.cloture.mois)}</h2>{r.cloture.pret ? <span className="badge">prête</span> : <span className="badge yolk">à finir</span>}</div>
        <ul className="cloture">
          <li className={r.cloture.operations > 0 ? "fait" : ""}>{r.cloture.operations} opérations importées</li>
          <li className={r.cloture.a_classer === 0 ? "fait" : ""}>{r.cloture.a_classer === 0 ? "Toutes les opérations sont classées" : `${r.cloture.a_classer} opération${r.cloture.a_classer > 1 ? "s" : ""} à classer`}</li>
          <li className={r.cloture.a_justifier.length === 0 ? "fait" : ""}>{r.cloture.a_justifier.length === 0 ? "Grosses dépenses justifiées" : `${r.cloture.a_justifier.length} grosse${r.cloture.a_justifier.length > 1 ? "s" : ""} dépense${r.cloture.a_justifier.length > 1 ? "s" : ""} sans justificatif`}</li>
        </ul>
        {r.cloture.a_justifier.map((t) => <div className="op" key={t.date + t.libelle}><span>{t.libelle}<small>{t.date.split("-").reverse().join("/")}</small></span><b>{eur(t.montant, true)}</b><button className="link" onClick={() => go("add")}>Joindre</button></div>)}
        <button className="btn ghost block" style={{ marginTop: 12 }} onClick={async () => { try { telecharger(await api.grandLivre(), "grand-livre-lucien.csv"); } catch (e) { toast((e as Error).message); } }}>Exporter le grand livre (tableur)</button>
      </section>

      {data.comptes.length > 1 && (
        <section className="section">
          <div className="section-head"><h2>Comptes suivis</h2></div>
          <p className="note" style={{ marginTop: -4 }}>Un compte professionnel reste hors du budget du foyer : il est suivi dans Vie pro.</p>
          {data.comptes.map((c) => (
            <div className="settings-row" key={c}><div><div className="t">{c}</div><div className="s">{exclus.has(c) ? "Professionnel, hors budget du foyer" : "Compté dans le budget du foyer"}</div></div>
              <button className="toggle" role="switch" aria-checked={!exclus.has(c)} aria-label={`Compter ${c} dans le budget`} onClick={() => basculerCompte(c)} /></div>
          ))}
        </section>
      )}
      <p className="note">Numéros de compte inspirés du plan comptable, pour le repère : un foyer n'a pas d'obligation comptable.</p>
    </div>
  );
}

function Jauge({ titre, valeur, max, seuil, unite, texte, inverse = false }: { titre: string; valeur: number | null; max: number; seuil: number; unite: string; texte: string; inverse?: boolean }) {
  const ok = valeur === null ? null : inverse ? valeur <= seuil : valeur >= seuil;
  return (
    <div className={`jauge ${ok === null ? "" : ok ? "ok" : "alerte"}`}>
      <div className="jauge-tete"><span>{titre}</span><b>{valeur === null ? "—" : `${valeur.toLocaleString("fr-FR")} ${unite}`}</b></div>
      <div className="jauge-barre"><i style={{ width: `${Math.min(100, ((valeur ?? 0) / max) * 100)}%` }} /><em style={{ left: `${(seuil / max) * 100}%` }} /></div>
      <p>{texte}</p>
    </div>
  );
}
