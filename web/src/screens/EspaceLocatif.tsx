import { useState } from "react";
import type { Api } from "../api";
import { quittance, relance, SOURCE_IRL, type Bail, type Bien, type Encaissement } from "../../../server/src/locatif";
import { Alertes, Champ, Chiffres, dateFr, EnTete, eur, Feuille, moisCourt, nouvelId, pct, useEspace, Verrou } from "./espacesCommun";

const STATUT: Record<Encaissement["statut"], string> = { paye: "payé", partiel: "partiel", impaye: "impayé", a_venir: "à venir" };
const BIEN_VIDE = { nom: "", adresse: "", type: "appartement", meuble: false, prix_achat: "", taxe_fonciere: "", assurance_pno: "", charges_non_recuperables: "", credit_mensualite: "", interets_annuels: "", dpe: "D", dpe_date: "" };
const BAIL_VIDE = { locataire: "", loyer_hc: "", charges: "", debut: "", irl_trimestre: "1", depot_garantie: "", jour_paiement: "5" };

/** Patrimoine locatif : biens, loyers rapprochés de la banque, quittances, relances, IRL, DPE, fiscalité. */
export function EspaceLocatif({ api, go, onBack, toast }: { api: Api; go: (s: string, id?: string) => void; onBack: () => void; toast: (m: string) => void }) {
  const { data, ferme, err, sauver } = useEspace(api, "locatif");
  const [doc, setDoc] = useState<{ titre: string; texte: string; fichier: string } | null>(null);
  const [ajoutBien, setAjoutBien] = useState(false);
  const [bienF, setBienF] = useState(BIEN_VIDE);
  const [bailPour, setBailPour] = useState<string | null>(null);
  const [bailF, setBailF] = useState(BAIL_VIDE);
  if (ferme) return <Verrou module={ferme} go={go} onBack={onBack} />;
  if (!data) return <div className="screen"><EnTete titre="Patrimoine locatif" sous="Chargement…" espace="locatif" onBack={onBack} />{err && <p className="note">{err}</p>}</div>;
  const { rapport: r, donnees: d } = data;
  const n = (s: string) => Number(String(s).replace(",", ".")) || 0;

  const enregistrerBien = async () => {
    if (!bienF.nom.trim() || !bienF.adresse.trim()) return toast("Nom et adresse du bien, s'il vous plaît");
    const b: Bien = { id: nouvelId(), nom: bienF.nom.trim(), adresse: bienF.adresse.trim(), type: bienF.type as Bien["type"], meuble: bienF.meuble, prix_achat: n(bienF.prix_achat), taxe_fonciere: n(bienF.taxe_fonciere), assurance_pno: n(bienF.assurance_pno), charges_non_recuperables: n(bienF.charges_non_recuperables), credit_mensualite: n(bienF.credit_mensualite), interets_annuels: n(bienF.interets_annuels), dpe: (bienF.dpe || null) as Bien["dpe"], dpe_date: bienF.dpe_date || null };
    await sauver({ ...d, biens: [...d.biens, b] }); setAjoutBien(false); setBienF(BIEN_VIDE); setBailPour(b.id); toast("Bien ajouté : ajoutez son bail");
  };
  const enregistrerBail = async () => {
    if (!bailPour || !bailF.locataire.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(bailF.debut) || n(bailF.loyer_hc) <= 0) return toast("Locataire, loyer et date de début, s'il vous plaît");
    const b: Bail = { id: nouvelId(), bien_id: bailPour, locataire: bailF.locataire.trim(), loyer_hc: n(bailF.loyer_hc), charges: n(bailF.charges), debut: bailF.debut, irl_trimestre: Number(bailF.irl_trimestre) as 1, depot_garantie: n(bailF.depot_garantie), jour_paiement: Math.min(31, Math.max(1, n(bailF.jour_paiement) || 5)) };
    await sauver({ ...d, baux: [...d.baux.filter((x) => x.bien_id !== bailPour || (x.fin && x.fin < b.debut)), b] }); setBailPour(null); setBailF(BAIL_VIDE); toast("Bail enregistré");
  };
  const marquerPaye = async (bail: Bail, e: Encaissement) => {
    await sauver({ ...d, encaissements_manuels: [...(d.encaissements_manuels ?? []), { bail_id: bail.id, mois: e.mois, montant: Math.round((e.attendu - e.recu) * 100) / 100, date: new Date().toISOString().slice(0, 10) }] });
    toast(`Loyer de ${moisCourt(e.mois)} noté comme reçu`);
  };
  const appliquerRevision = async (bail: Bail, loyer: number, indice: string) => {
    await sauver({ ...d, baux: d.baux.map((x) => (x.id === bail.id ? { ...x, loyer_hc: loyer, irl_base: indice } : x)) });
    toast("Nouveau loyer enregistré");
  };

  return (
    <div className="screen espace">
      <EnTete titre="Patrimoine locatif" sous="Vos biens loués suivis comme par une agence, sans les frais d'agence" espace="locatif" onBack={onBack} />
      <Alertes alertes={r.alertes} />
      <Chiffres items={[
        { label: "loyers par an", valeur: eur(r.totaux.loyers_annuels), detail: "hors charges" },
        { label: "impayés", valeur: eur(r.totaux.impayes), ton: r.totaux.impayes > 0 ? "alerte" : "ok" },
        { label: "cash-flow par mois", valeur: eur(r.totaux.cash_flow_mensuel), ton: r.totaux.cash_flow_mensuel >= 0 ? "ok" : "alerte", detail: "après crédit et charges" },
        { label: "biens", valeur: String(r.biens.length), detail: eur(r.totaux.valeur) + " investis" },
      ]} />

      {r.biens.map((b) => {
        const dernierPaye = [...b.encaissements].reverse().find((e) => e.statut === "paye");
        const impaye = b.encaissements.find((e) => e.statut === "impaye" || e.statut === "partiel");
        return (
          <section className="section bien-carte" key={b.bien.id}>
            <div className="bien-tete">
              <div><h2>{b.bien.nom}</h2><p>{b.bien.adresse}</p></div>
              <span className={`dpe dpe-${b.bien.dpe ?? "x"}`} title="Classe énergie (DPE)">{b.bien.dpe ?? "?"}</span>
            </div>
            <div className="bien-tags"><span>{b.bien.meuble ? "Meublé" : "Location nue"}</span>{b.bien.surface ? <span>{b.bien.surface} m²</span> : null}{b.bail && <span>{b.bail.locataire}</span>}{b.bail && <span>{eur(b.loyer_cc)} charges comprises</span>}</div>
            {b.bail ? (
              <>
                <div className="loyers" aria-label="Loyers des derniers mois">
                  {b.encaissements.map((e) => <div key={e.mois} className={`loyer ${e.statut}`} title={e.libelle ?? undefined}><span>{moisCourt(e.mois)}</span><i /><small>{e.statut === "paye" ? dateFr(e.date).slice(0, 5) : STATUT[e.statut]}</small></div>)}
                </div>
                {impaye && <div className="impaye"><b>{eur(impaye.attendu - impaye.recu)} en retard</b><span>{impaye.retard_jours} jour{impaye.retard_jours > 1 ? "s" : ""} après l'échéance du {b.bail.jour_paiement}</span></div>}
                <div className="bien-chiffres">
                  <div><b>{pct(b.rentabilite_brute)}</b><span>rentabilité brute</span></div>
                  <div><b>{pct(b.rentabilite_nette)}</b><span>nette de charges</span></div>
                  <div><b>{eur(b.cash_flow_mensuel)}</b><span>cash-flow / mois</span></div>
                </div>
                {b.revision && (
                  <div className={`revision ${b.revision.gel ? "gel" : ""}`}>
                    <b>{b.revision.gel ? "Loyer gelé (DPE F ou G)" : `Révision du loyer le ${dateFr(b.revision.date)}`}</b>
                    {!b.revision.gel && (b.revision.nouveau_loyer
                      ? <span>IRL {b.revision.indice_nouveau.replace("T", " T")} ({b.revision.valeur_nouvelle?.toLocaleString("fr-FR")}) contre {b.revision.indice_ancien.replace("T", " T")} ({b.revision.valeur_ancienne?.toLocaleString("fr-FR")}) : {eur(b.bail.loyer_hc, true)} → <b>{eur(b.revision.nouveau_loyer, true)}</b> hors charges (+{eur(b.revision.hausse, true)}).</span>
                      : <span>En attente de la publication de l'IRL {b.revision.indice_nouveau.replace("T", " T")} par l'Insee.</span>)}
                    {!b.revision.gel && b.revision.nouveau_loyer && b.revision.dans_jours <= 0 && <button className="link" onClick={() => appliquerRevision(b.bail!, b.revision!.nouveau_loyer!, b.revision!.indice_nouveau)}>Appliquer le nouveau loyer</button>}
                  </div>
                )}
                <div className="bien-actions">
                  {dernierPaye && <button className="btn ghost" onClick={() => setDoc({ titre: `Quittance de ${moisCourt(dernierPaye.mois)}`, texte: quittance(d, b.bail!, b.bien, dernierPaye), fichier: `quittance-${dernierPaye.mois}-${b.bail!.locataire.replace(/\s+/g, "-").toLowerCase()}.txt` })}>Quittance de {moisCourt(dernierPaye.mois)}</button>}
                  {impaye && <button className="btn ghost" onClick={() => setDoc({ titre: "Relance amiable", texte: relance(d, b.bail!, b.bien, impaye), fichier: `relance-${impaye.mois}.txt` })}>Relancer</button>}
                  {impaye && <button className="btn ghost" onClick={() => marquerPaye(b.bail!, impaye)}>Reçu en espèces ou chèque</button>}
                </div>
              </>
            ) : (
              <button className="btn ghost" onClick={() => setBailPour(b.bien.id)}>Ajouter le bail</button>
            )}
            {b.dpe && <p className={`note dpe-note ${b.dpe.niveau}`}>{b.dpe.texte}</p>}
            {bailPour === b.bien.id && (
              <div className="lock form-espace">
                <Champ label="Locataire"><input className="in" value={bailF.locataire} onChange={(e) => setBailF({ ...bailF, locataire: e.target.value })} /></Champ>
                <Champ label="Loyer hors charges (€)"><input className="in" inputMode="decimal" value={bailF.loyer_hc} onChange={(e) => setBailF({ ...bailF, loyer_hc: e.target.value })} /></Champ>
                <Champ label="Provision pour charges (€)"><input className="in" inputMode="decimal" value={bailF.charges} onChange={(e) => setBailF({ ...bailF, charges: e.target.value })} /></Champ>
                <Champ label="Début du bail"><input className="in" type="date" value={bailF.debut} onChange={(e) => setBailF({ ...bailF, debut: e.target.value })} /></Champ>
                <Champ label="Trimestre IRL du bail"><select className="in" value={bailF.irl_trimestre} onChange={(e) => setBailF({ ...bailF, irl_trimestre: e.target.value })}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t}e trimestre</option>)}</select></Champ>
                <Champ label="Dépôt de garantie (€)"><input className="in" inputMode="decimal" value={bailF.depot_garantie} onChange={(e) => setBailF({ ...bailF, depot_garantie: e.target.value })} /></Champ>
                <Champ label="Jour de paiement"><input className="in" inputMode="numeric" value={bailF.jour_paiement} onChange={(e) => setBailF({ ...bailF, jour_paiement: e.target.value })} /></Champ>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={enregistrerBail}>Enregistrer le bail</button><button className="btn ghost" onClick={() => setBailPour(null)}>Annuler</button></div>
              </div>
            )}
          </section>
        );
      })}

      {ajoutBien ? (
        <section className="section">
          <div className="lock form-espace">
            <Champ label="Nom du bien"><input className="in" value={bienF.nom} onChange={(e) => setBienF({ ...bienF, nom: e.target.value })} placeholder="T2 rue de la Loge" /></Champ>
            <Champ label="Adresse"><input className="in" value={bienF.adresse} onChange={(e) => setBienF({ ...bienF, adresse: e.target.value })} /></Champ>
            <Champ label="Type"><select className="in" value={bienF.type} onChange={(e) => setBienF({ ...bienF, type: e.target.value })}>{["appartement", "studio", "maison", "local", "parking"].map((x) => <option key={x}>{x}</option>)}</select></Champ>
            <Champ label="Loué meublé"><input type="checkbox" checked={bienF.meuble} onChange={(e) => setBienF({ ...bienF, meuble: e.target.checked })} /></Champ>
            <Champ label="Prix d'achat (€)"><input className="in" inputMode="decimal" value={bienF.prix_achat} onChange={(e) => setBienF({ ...bienF, prix_achat: e.target.value })} /></Champ>
            <Champ label="Taxe foncière / an (€)"><input className="in" inputMode="decimal" value={bienF.taxe_fonciere} onChange={(e) => setBienF({ ...bienF, taxe_fonciere: e.target.value })} /></Champ>
            <Champ label="Assurance PNO / an (€)"><input className="in" inputMode="decimal" value={bienF.assurance_pno} onChange={(e) => setBienF({ ...bienF, assurance_pno: e.target.value })} /></Champ>
            <Champ label="Charges non récupérables / an (€)"><input className="in" inputMode="decimal" value={bienF.charges_non_recuperables} onChange={(e) => setBienF({ ...bienF, charges_non_recuperables: e.target.value })} /></Champ>
            <Champ label="Mensualité de crédit (€)"><input className="in" inputMode="decimal" value={bienF.credit_mensualite} onChange={(e) => setBienF({ ...bienF, credit_mensualite: e.target.value })} /></Champ>
            <Champ label="Intérêts d'emprunt / an (€)"><input className="in" inputMode="decimal" value={bienF.interets_annuels} onChange={(e) => setBienF({ ...bienF, interets_annuels: e.target.value })} /></Champ>
            <Champ label="DPE"><select className="in" value={bienF.dpe} onChange={(e) => setBienF({ ...bienF, dpe: e.target.value })}>{["A", "B", "C", "D", "E", "F", "G"].map((x) => <option key={x}>{x}</option>)}</select></Champ>
            <Champ label="Date du DPE"><input className="in" type="date" value={bienF.dpe_date} onChange={(e) => setBienF({ ...bienF, dpe_date: e.target.value })} /></Champ>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={enregistrerBien}>Ajouter le bien</button><button className="btn ghost" onClick={() => setAjoutBien(false)}>Annuler</button></div>
          </div>
        </section>
      ) : <button className="btn ghost block" style={{ marginTop: 16 }} onClick={() => setAjoutBien(true)}>Ajouter un bien</button>}

      {(r.fiscal.nu || r.fiscal.meuble) && (
        <section className="section">
          <div className="section-head"><h2>Déclaration des loyers</h2></div>
          {r.fiscal.nu && <div className="conseil-fiscal"><b>Location nue · {eur(r.fiscal.nu.recettes)} de loyers par an</b><p>{r.fiscal.nu.conseil}</p><small>Micro-foncier : {eur(r.fiscal.nu.micro.base)} imposés (plafond 15 000 €). Réel : {eur(r.fiscal.nu.reel.resultat)} après {eur(r.fiscal.nu.charges_deductibles)} de charges. {r.fiscal.nu.cases}</small></div>}
          {r.fiscal.meuble && <div className="conseil-fiscal"><b>Location meublée · {eur(r.fiscal.meuble.recettes)} de recettes par an</b><p>{r.fiscal.meuble.conseil}</p><small>Micro-BIC : {eur(r.fiscal.meuble.micro.base)} imposés (plafond {eur(r.fiscal.meuble.seuil)}). {r.fiscal.meuble.cases}</small></div>}
          <p className="note">Estimations sur les loyers des baux en cours, à vérifier chaque année sur impots.gouv.fr. Prélèvements sociaux en plus (17,2 % sur les revenus fonciers).</p>
        </section>
      )}

      {r.echeances.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>À venir</h2></div>
          <ul className="list">{r.echeances.map((e) => <li key={e.titre}><div className="row-item" style={{ gridTemplateColumns: "auto 1fr" }}><div className="date-chip"><b>{Number(e.date.slice(8, 10))}</b><span>{moisCourt(e.date.slice(0, 7))}</span></div><div><div className="t">{e.titre}</div><div className="s">{e.detail}</div></div></div></li>)}</ul>
        </section>
      )}
      <p className="note">Indices IRL : <a href={SOURCE_IRL} target="_blank" rel="noreferrer">Insee</a>. Quittance gratuite et due à la demande du locataire (loi du 6 juillet 1989, art. 21).</p>
      {doc && <Feuille titre={doc.titre} texte={doc.texte} fichier={doc.fichier} onClose={() => setDoc(null)} />}
    </div>
  );
}
