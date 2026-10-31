import { useEffect, useState } from "react";
import type { Api, PartageComptable, VueComptable } from "../api";
import { livreCsv, RUBRIQUES } from "../../../server/src/viePro";
import { Logo } from "../ui";
import { Chiffres, dateFr, eur, telecharger } from "./espacesCommun";

/** In Vie pro: give the accountant (or approved management association) a read-only link, revocable at any time. */
export function PartageComptablePanneau({ api, memberId, prenom, toast }: { api: Api; memberId: string | null; prenom: string; toast: (m: string) => void }) {
  const [liste, setListe] = useState<PartageComptable[]>([]);
  const [nom, setNom] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const charger = () => api.partagesPro().then((l) => setListe(l.filter((x) => x.member_id === memberId))).catch(() => setListe([]));
  useEffect(() => { charger(); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps
  const lien = (t: string) => `${location.origin}${location.pathname}#/comptable/${t}`;
  const creer = async () => {
    try {
      const p = await api.creerPartagePro(memberId, nom.trim() || null);
      try { await navigator.clipboard.writeText(lien(p.token)); toast("Lien copié : envoyez-le à votre comptable"); } catch { toast("Lien créé"); }
      setNom(""); setOuvert(false); charger();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="partage-comptable">
      <b>Votre comptable</b>
      <p>Un lien en lecture seule sur l'activité de {prenom === "Moi" ? "votre" : prenom} : recettes, dépenses, rubriques de la 2035, livre à télécharger. Ni les bulletins, ni le reste du foyer. Valable un an, révocable à tout moment.</p>
      {liste.map((p) => (
        <div className="pc-ligne" key={p.token}>
          <span>{p.nom ?? "Comptable"}<small>jusqu'au {dateFr(p.expire_le.slice(0, 10))}</small></span>
          <button className="link" onClick={async () => { try { await navigator.clipboard.writeText(lien(p.token)); toast("Lien copié"); } catch { toast(lien(p.token)); } }}>Copier le lien</button>
          <button className="link danger" onClick={async () => { await api.revoquerPartagePro(p.token); charger(); toast("Accès retiré"); }}>Retirer</button>
        </div>
      ))}
      {ouvert ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input className="in" style={{ flex: 1 }} placeholder="Cabinet, association de gestion…" value={nom} onChange={(e) => setNom(e.target.value)} />
          <button className="btn" onClick={creer}>Créer le lien</button>
        </div>
      ) : <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setOuvert(true)}>Partager avec mon comptable</button>}
    </div>
  );
}

/** What the accountant opens: the client's independent activity, read only, with the ledger to download. */
export function PageComptable({ api, token }: { api: Api; token: string }) {
  const [v, setV] = useState<VueComptable | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.vueComptable(token).then(setV).catch((e) => setErr((e as Error).message)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="app"><div className="screen comptable-page"><div className="home-brand"><Logo /></div><p className="note" style={{ marginTop: 24 }}>{err}</p></div></div>;
  if (!v) return <div className="app"><div className="screen comptable-page"><div className="home-brand"><Logo /></div><p className="note">Chargement…</p></div></div>;
  const i = v.independant;
  return (
    <div className="app">
      <div className="screen comptable-page">
        <div className="home-brand"><Logo /></div>
        <span className="badge">Accès comptable · lecture seule</span>
        <h1 className="detail-title" style={{ marginTop: 10 }}>{v.prenom === "Moi" ? "Votre client" : v.prenom}</h1>
        <p className="detail-sub">{i.activite} · {i.regime === "bnc_2035" ? "BNC, déclaration contrôlée (2035)" : "micro-BNC"} · année {i.annee}, au {dateFr(new Date().toISOString().slice(0, 10))}</p>
        <Chiffres items={[
          { label: "recettes encaissées", valeur: eur(i.recettes), ton: "ok" },
          { label: "dépenses déductibles", valeur: eur(i.depenses) },
          { label: "bénéfice estimé", valeur: eur(i.benefice) },
          { label: "prélèvements perso", valeur: eur(i.prelevements), detail: "non déductibles" },
        ]} />
        <div className="conseil-fiscal"><b>Micro ou réel</b><p>{i.micro.conseil}</p></div>
        <h3 className="sous-titre">Rubriques de la 2035</h3>
        <ul className="rubriques">{i.par_rubrique.map((x) => <li key={x.rubrique}><span>{x.libelle}<small>{x.nb} opération{x.nb > 1 ? "s" : ""}</small></span><b>{eur(x.montant)}</b></li>)}</ul>
        {i.immobilisations.length > 0 && <><h3 className="sous-titre">À immobiliser</h3><ul className="rubriques">{i.immobilisations.map((x) => <li key={x.date + x.libelle}><span>{x.libelle}<small>{dateFr(x.date)}</small></span><b>{eur(x.montant, true)}</b></li>)}</ul></>}
        {i.a_classer.length > 0 && <><h3 className="sous-titre">Non classées par le client</h3><ul className="rubriques">{i.a_classer.map((x) => <li key={x.date + x.libelle}><span>{x.libelle}<small>{dateFr(x.date)}</small></span><b>{eur(x.montant, true)}</b></li>)}</ul></>}
        <button className="btn block" style={{ marginTop: 16 }} onClick={() => telecharger(livreCsv(i), `livre-recettes-depenses-${i.annee}.csv`)}>Télécharger le livre des recettes et des dépenses</button>
        <h3 className="sous-titre">Livre ({i.livre.length} opérations)</h3>
        <div className="livre">{i.livre.slice().reverse().map((l, k) => <div key={k} className={l.montant > 0 ? "rec" : ""}><span>{dateFr(l.date)}</span><span>{l.libelle}<small>{RUBRIQUES[l.rubrique]}</small></span><b>{l.montant > 0 ? "+" : ""}{eur(l.montant, true)}</b></div>)}</div>
        <p className="note">Données tirées du compte professionnel du client par Lucien. Lien {v.nom_comptable ? `remis à ${v.nom_comptable}, ` : ""}valable jusqu'au {dateFr(v.expire_le.slice(0, 10))}, révocable par le client.</p>
      </div>
    </div>
  );
}
