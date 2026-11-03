import { useEffect, useState } from "react";
import type { Api } from "../api";
import { NOM_INDICE, quittance, relance, SOURCE_INDICE, SOURCE_IRL, type Bail, type Bien, type Encaissement } from "../../../server/src/locatif";
import { Alertes, Champ, Chiffres, dateFr, EnTete, eur, Feuille, moisCourt, nouvelId, pct, useEspace, Verrou, LireDocument } from "./espacesCommun";

const STATUT: Record<Encaissement["statut"], string> = { paye: "payé", partiel: "partiel", impaye: "impayé", a_venir: "à venir" };
const BIEN_VIDE = { surface: "", tourisme: "", structure_id: "", sci_nom: "", sci_regime: "ir", sci_parts: "100", nom: "", adresse: "", type: "appartement", meuble: false, prix_achat: "", taxe_fonciere: "", assurance_pno: "", charges_non_recuperables: "", credit_mensualite: "", interets_annuels: "", dpe: "D", dpe_date: "" };
const BAIL_VIDE = { type: "habitation", indice: "irl", tva: false, fin: "", locataire: "", loyer_hc: "", charges: "", debut: "", irl_trimestre: "1", depot_garantie: "", jour_paiement: "5" };

/** Patrimoine locatif : biens, loyers rapprochés de la banque, quittances, relances, IRL, DPE, fiscalité. */
export function EspaceLocatif({ api, go, onBack, toast }: { api: Api; go: (s: string, id?: string) => void; onBack: () => void; toast: (m: string) => void }) {
  const { data, ferme, err, sauver, charger } = useEspace(api, "locatif");
  const [doc, setDoc] = useState<{ titre: string; texte: string; fichier: string } | null>(null);
  const [ajoutBien, setAjoutBien] = useState(false);
  const [bienF, setBienF] = useState(BIEN_VIDE);
  const [bailPour, setBailPour] = useState<string | null>(null);
  const [bailF, setBailF] = useState(BAIL_VIDE);
  const [bienEdite, setBienEdite] = useState<string | null>(null); // id of the property being edited
  const [bailEdite, setBailEdite] = useState<string | null>(null); // id of the lease being edited
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  if (ferme) return <Verrou module={ferme} go={go} onBack={onBack} />;
  if (!data) return <div className="screen"><EnTete titre="Patrimoine locatif" sous="Chargement…" espace="locatif" onBack={onBack} />{err && <p className="note">{err}</p>}</div>;
  const { rapport: r, donnees: d } = data;
  const n = (s: string) => Number(String(s).replace(",", ".")) || 0;

  const enregistrerBien = async () => {
    if (!bienF.nom.trim() || !bienF.adresse.trim()) return toast("Nom et adresse du bien, s'il vous plaît");
    let structures = d.structures ?? [];
    let structure_id: string | null = bienF.structure_id || null;
    if (structure_id === "+") {
      if (!bienF.sci_nom.trim()) return toast("Nom de la SCI, s'il vous plaît");
      const st = { id: nouvelId(), nom: bienF.sci_nom.trim(), regime: bienF.sci_regime as "ir" | "is", parts_foyer: Math.min(100, Math.max(0, n(bienF.sci_parts) || 100)) };
      structures = [...structures, st]; structure_id = st.id;
    }
    const avant = bienEdite ? d.biens.find((x) => x.id === bienEdite) : undefined;
    const b: Bien = { ...avant, surface: n(bienF.surface) || null, structure_id, tourisme: bienF.meuble && bienF.tourisme ? (bienF.tourisme as "classe") : null, id: avant?.id ?? nouvelId(), nom: bienF.nom.trim(), adresse: bienF.adresse.trim(), type: bienF.type as Bien["type"], meuble: bienF.meuble, prix_achat: n(bienF.prix_achat), taxe_fonciere: n(bienF.taxe_fonciere), assurance_pno: n(bienF.assurance_pno), charges_non_recuperables: n(bienF.charges_non_recuperables), credit_mensualite: n(bienF.credit_mensualite), interets_annuels: n(bienF.interets_annuels), dpe: (bienF.dpe || null) as Bien["dpe"], dpe_date: bienF.dpe_date || null };
    if (avant) {
      await sauver({ ...d, structures, biens: d.biens.map((x) => (x.id === avant.id ? b : x)) }); setBienEdite(null); setBienF(BIEN_VIDE);
      return toast("Bien modifié");
    }
    await sauver({ ...d, structures, biens: [...d.biens, b] }); setAjoutBien(false); setBienF(BIEN_VIDE);
    if (b.tourisme) toast("Bien ajouté : ses recettes de plateformes apparaîtront depuis la banque"); else { setBailPour(b.id); toast("Bien ajouté : ajoutez son bail"); }
  };
  const enregistrerBail = async () => {
    if (!bailPour || !bailF.locataire.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(bailF.debut) || n(bailF.loyer_hc) <= 0) return toast("Locataire, loyer et date de début, s'il vous plaît");
    if (bailF.fin && (!/^\d{4}-\d{2}-\d{2}$/.test(bailF.fin) || bailF.fin < bailF.debut)) return toast("La fin du bail doit suivre son début");
    const avant = bailEdite ? d.baux.find((x) => x.id === bailEdite) : undefined;
    const b: Bail = { ...avant, fin: bailF.fin || null, id: avant?.id ?? nouvelId(), bien_id: bailPour, locataire: bailF.locataire.trim(), loyer_hc: n(bailF.loyer_hc), charges: n(bailF.charges), debut: bailF.debut, irl_trimestre: Number(bailF.irl_trimestre) as 1, depot_garantie: n(bailF.depot_garantie), jour_paiement: Math.min(31, Math.max(1, n(bailF.jour_paiement) || 5)),
      type: bailF.type === "commercial" ? "commercial" : null, indice: bailF.type === "commercial" ? (bailF.indice === "irl" ? "ilc" : bailF.indice) as Bail["indice"] : null, tva: bailF.type === "commercial" ? bailF.tva : null };
    if (avant) await sauver({ ...d, baux: d.baux.map((x) => (x.id === avant.id ? b : x)) });
    else await sauver({ ...d, baux: [...d.baux.filter((x) => x.bien_id !== bailPour || (x.fin && x.fin < b.debut)), b] });
    setBailPour(null); setBailEdite(null); setBailF(BAIL_VIDE);
    toast(avant ? (b.fin && b.fin < new Date().toISOString().slice(0, 10) ? "Bail terminé : le bien attend son prochain locataire" : "Bail modifié") : "Bail enregistré");
  };
  const s = (x: number | null | undefined) => (x ? String(x) : "");
  const modifierBien = (b: Bien) => {
    setAjoutBien(false); setBailPour(null); setASupprimer(null); setBienEdite(b.id);
    setBienF({ ...BIEN_VIDE, nom: b.nom, adresse: b.adresse, type: b.type, meuble: b.meuble, surface: s(b.surface), tourisme: b.tourisme ?? "", structure_id: b.structure_id ?? "",
      prix_achat: s(b.prix_achat), taxe_fonciere: s(b.taxe_fonciere), assurance_pno: s(b.assurance_pno), charges_non_recuperables: s(b.charges_non_recuperables),
      credit_mensualite: s(b.credit_mensualite), interets_annuels: s(b.interets_annuels), dpe: b.dpe ?? "D", dpe_date: b.dpe_date ?? "" });
  };
  const modifierBail = (b: Bail) => {
    setBienEdite(null); setASupprimer(null); setBailPour(b.bien_id); setBailEdite(b.id);
    setBailF({ type: b.type === "commercial" ? "commercial" : "habitation", indice: b.indice ?? "irl", tva: !!b.tva, locataire: b.locataire, loyer_hc: s(b.loyer_hc), charges: s(b.charges), debut: b.debut, fin: b.fin ?? "", irl_trimestre: String(b.irl_trimestre), depot_garantie: s(b.depot_garantie), jour_paiement: String(b.jour_paiement) });
  };
  /** Removes the property with its leases and the rents noted by hand for them; the bank transactions stay untouched. */
  const supprimerBien = async (id: string) => {
    const baux = new Set(d.baux.filter((x) => x.bien_id === id).map((x) => x.id));
    await sauver({ ...d, biens: d.biens.filter((x) => x.id !== id), baux: d.baux.filter((x) => !baux.has(x.id)), encaissements_manuels: (d.encaissements_manuels ?? []).filter((e) => !baux.has(e.bail_id)) });
    setASupprimer(null); toast("Bien supprimé");
  };
  const marquerPaye = async (bail: Bail, e: Encaissement) => {
    await sauver({ ...d, encaissements_manuels: [...(d.encaissements_manuels ?? []), { bail_id: bail.id, mois: e.mois, montant: Math.round((e.attendu - e.recu) * 100) / 100, date: new Date().toISOString().slice(0, 10) }] });
    toast(`Loyer de ${moisCourt(e.mois)} noté comme reçu`);
  };
  const appliquerRevision = async (bail: Bail, loyer: number, indice: string) => {
    await sauver({ ...d, baux: d.baux.map((x) => (x.id === bail.id ? { ...x, loyer_hc: loyer, irl_base: indice } : x)) });
    toast("Nouveau loyer enregistré");
  };

  const formBien = () => (
          <div className="lock form-espace">
            <Champ label="Nom du bien"><input className="in" value={bienF.nom} onChange={(e) => setBienF({ ...bienF, nom: e.target.value })} placeholder="T2 rue de la Loge" /></Champ>
            <Champ label="Adresse"><input className="in" value={bienF.adresse} onChange={(e) => setBienF({ ...bienF, adresse: e.target.value })} /></Champ>
            <Champ label="Type"><select className="in" value={bienF.type} onChange={(e) => setBienF({ ...bienF, type: e.target.value })}>{["appartement", "studio", "maison", "local", "parking"].map((x) => <option key={x}>{x}</option>)}</select></Champ>
            <Champ label="Surface (m²)"><input className="in" inputMode="decimal" value={bienF.surface} onChange={(e) => setBienF({ ...bienF, surface: e.target.value })} /></Champ>
            <Champ label="Loué meublé"><input type="checkbox" checked={bienF.meuble} onChange={(e) => setBienF({ ...bienF, meuble: e.target.checked })} /></Champ>
            {bienF.meuble && <Champ label="Location"><select className="in" value={bienF.tourisme} onChange={(e) => setBienF({ ...bienF, tourisme: e.target.value })}><option value="">Longue durée (bail)</option><option value="non_classe">Meublé de tourisme non classé</option><option value="classe">Meublé de tourisme classé</option></select></Champ>}
            <Champ label="Détenu par"><select className="in" value={bienF.structure_id} onChange={(e) => setBienF({ ...bienF, structure_id: e.target.value })}><option value="">Le foyer, en direct</option>{(d.structures ?? []).map((x) => <option key={x.id} value={x.id}>{x.nom} ({x.regime.toUpperCase()})</option>)}<option value="+">Une nouvelle SCI…</option></select></Champ>
            {bienF.structure_id === "+" && <>
              <Champ label="Nom de la SCI"><input className="in" value={bienF.sci_nom} onChange={(e) => setBienF({ ...bienF, sci_nom: e.target.value })} /></Champ>
              <Champ label="Imposition de la SCI"><select className="in" value={bienF.sci_regime} onChange={(e) => setBienF({ ...bienF, sci_regime: e.target.value })}><option value="ir">Impôt sur le revenu</option><option value="is">Impôt sur les sociétés</option></select></Champ>
              <Champ label="Parts du foyer (%)"><input className="in" inputMode="decimal" value={bienF.sci_parts} onChange={(e) => setBienF({ ...bienF, sci_parts: e.target.value })} /></Champ>
            </>}
            <Champ label="Prix d'achat (€)"><input className="in" inputMode="decimal" value={bienF.prix_achat} onChange={(e) => setBienF({ ...bienF, prix_achat: e.target.value })} /></Champ>
            <Champ label="Taxe foncière / an (€)"><input className="in" inputMode="decimal" value={bienF.taxe_fonciere} onChange={(e) => setBienF({ ...bienF, taxe_fonciere: e.target.value })} /></Champ>
            <Champ label="Assurance PNO / an (€)"><input className="in" inputMode="decimal" value={bienF.assurance_pno} onChange={(e) => setBienF({ ...bienF, assurance_pno: e.target.value })} /></Champ>
            <Champ label="Charges non récupérables / an (€)"><input className="in" inputMode="decimal" value={bienF.charges_non_recuperables} onChange={(e) => setBienF({ ...bienF, charges_non_recuperables: e.target.value })} /></Champ>
            <Champ label="Mensualité de crédit (€)"><input className="in" inputMode="decimal" value={bienF.credit_mensualite} onChange={(e) => setBienF({ ...bienF, credit_mensualite: e.target.value })} /></Champ>
            <Champ label="Intérêts d'emprunt / an (€)"><input className="in" inputMode="decimal" value={bienF.interets_annuels} onChange={(e) => setBienF({ ...bienF, interets_annuels: e.target.value })} /></Champ>
            <Champ label="DPE"><select className="in" value={bienF.dpe} onChange={(e) => setBienF({ ...bienF, dpe: e.target.value })}>{["A", "B", "C", "D", "E", "F", "G"].map((x) => <option key={x}>{x}</option>)}</select></Champ>
            <Champ label="Date du DPE"><input className="in" type="date" value={bienF.dpe_date} onChange={(e) => setBienF({ ...bienF, dpe_date: e.target.value })} /></Champ>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={enregistrerBien}>{bienEdite ? "Enregistrer" : "Ajouter le bien"}</button><button className="btn ghost" onClick={() => { setAjoutBien(false); setBienEdite(null); setBienF(BIEN_VIDE); }}>Annuler</button></div>
          </div>
  );

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
            <div className="bien-tags"><span>{b.bien.tourisme ? `Meublé de tourisme ${b.bien.tourisme === "classe" ? "classé" : "non classé"}` : b.bien.meuble ? "Meublé" : "Location nue"}</span>{b.bien.structure_id && <span className="sci">{d.structures?.find((x) => x.id === b.bien.structure_id)?.nom ?? "SCI"}</span>}{b.bien.surface ? <span>{b.bien.surface} m²</span> : null}{b.bail && <span>{b.bail.locataire}</span>}{b.bail && <span>{eur(b.loyer_cc)} charges comprises</span>}</div>
            {b.bien.tourisme ? (
              <>
                <div className="saison" aria-label="Recettes des plateformes, 12 derniers mois">
                  {b.tourisme_12m.map((x) => <div key={x.mois}><i style={{ height: `${Math.max(6, (x.montant / Math.max(...b.tourisme_12m.map((y) => y.montant))) * 100)}%` }} /><small>{moisCourt(x.mois)}</small></div>)}
                </div>
                <div className="bien-chiffres">
                  <div><b>{eur(b.recettes_annuelles)}</b><span>recettes sur 12 mois</span></div>
                  <div><b>{pct(b.rentabilite_brute)}</b><span>rentabilité brute</span></div>
                  <div><b>{eur(b.cash_flow_mensuel)}</b><span>cash-flow / mois</span></div>
                </div>
                <p className="note">Versements Airbnb, Booking, Abritel… repérés sur votre compte. Pensez à la taxe de séjour et, selon votre commune, à l'enregistrement du meublé.</p>
              </>
            ) : b.bail ? (
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
                      ? <span>{NOM_INDICE[b.revision.indice]} {b.revision.indice_nouveau.replace("T", " T")} ({b.revision.valeur_nouvelle?.toLocaleString("fr-FR")}) contre {b.revision.indice_ancien.replace("T", " T")} ({b.revision.valeur_ancienne?.toLocaleString("fr-FR")}) : {eur(b.bail.loyer_hc, true)} → <b>{eur(b.revision.nouveau_loyer, true)}</b> hors charges ({(b.revision.hausse ?? 0) >= 0 ? "+" : "−"}{eur(Math.abs(b.revision.hausse ?? 0), true)}).{b.bail.type === "commercial" ? " Si votre bail n'a pas de clause d'indexation annuelle, la révision ne se fait que tous les trois ans, à la demande d'une des parties." : ""}</span>
                      : <span>En attente de la publication de l'{NOM_INDICE[b.revision.indice]} {b.revision.indice_nouveau.replace("T", " T")} par l'Insee.</span>)}
                    {!b.revision.gel && b.revision.nouveau_loyer && b.revision.dans_jours <= 0 && <button className="link" onClick={() => appliquerRevision(b.bail!, b.revision!.nouveau_loyer!, b.revision!.indice_nouveau)}>Appliquer le nouveau loyer</button>}
                  </div>
                )}
                {b.triennales && (
                  <div className="revision">
                    <b>Bail commercial : {b.triennales.prolongation ? `prolongé au-delà des 9 ans (depuis le ${dateFr(b.triennales.fin_9_ans)})` : `9 ans jusqu'au ${dateFr(b.triennales.fin_9_ans)}`}</b>
                    {b.triennales.prochaine && <span>Prochaine échéance triennale le {dateFr(b.triennales.prochaine)} : le locataire peut partir à cette date s'il donne congé au moins 6 mois avant, soit au plus tard le {dateFr(b.triennales.conge_avant!)}.</span>}
                    {b.triennales.prolongation && <span>Sans congé ni renouvellement, le bail continue aux mêmes conditions ; chacun peut y mettre fin avec 6 mois de préavis, pour la fin d'un trimestre civil. Pensez au renouvellement.</span>}
                    {b.bail.tva && <span>Loyer avec TVA : {eur(b.loyer_cc, true)} TTC par mois, charges comprises.</span>}
                  </div>
                )}
                <div className="bien-actions">
                  {dernierPaye && <button className="btn ghost" onClick={() => setDoc({ titre: `Quittance de ${moisCourt(dernierPaye.mois)}`, texte: quittance(d, b.bail!, b.bien, dernierPaye), fichier: `quittance-${dernierPaye.mois}-${b.bail!.locataire.replace(/\s+/g, "-").toLowerCase()}.txt` })}>Quittance de {moisCourt(dernierPaye.mois)}</button>}
                  {impaye && <button className="btn ghost" onClick={() => setDoc({ titre: "Relance amiable", texte: relance(d, b.bail!, b.bien, impaye), fichier: `relance-${impaye.mois}.txt` })}>Relancer</button>}
                  {impaye && <button className="btn ghost" onClick={() => marquerPaye(b.bail!, impaye)}>Reçu en espèces ou chèque</button>}
                </div>
              </>
            ) : (
              <button className="btn ghost" onClick={() => { setBailEdite(null); setBailF(b.bien.type === "local" ? { ...BAIL_VIDE, type: "commercial", indice: "ilc" } : BAIL_VIDE); setBailPour(b.bien.id); }}>Ajouter le bail</button>
            )}
            {b.dpe && <p className={`note dpe-note ${b.dpe.niveau}`}>{b.dpe.texte}</p>}
            {bailPour === b.bien.id && (
              <div className="lock form-espace">
                <Champ label="Type de bail"><select className="in" value={bailF.type} onChange={(e) => setBailF({ ...bailF, type: e.target.value, indice: e.target.value === "commercial" ? (bailF.indice === "irl" ? "ilc" : bailF.indice) : "irl" })}><option value="habitation">Habitation (loi de 1989)</option><option value="commercial">Commercial (3-6-9)</option></select></Champ>
                {bailF.type === "commercial" && <>
                  <Champ label="Indice de révision"><select className="in" value={bailF.indice} onChange={(e) => setBailF({ ...bailF, indice: e.target.value })}><option value="ilc">ILC (commerce, artisanat)</option><option value="ilat">ILAT (bureaux, professions libérales)</option></select></Champ>
                  <label className="case"><input type="checkbox" checked={bailF.tva} onChange={(e) => setBailF({ ...bailF, tva: e.target.checked })} /> Loyer soumis à la TVA (option de la SCI)</label>
                </>}
                <Champ label="Locataire"><input className="in" value={bailF.locataire} onChange={(e) => setBailF({ ...bailF, locataire: e.target.value })} /></Champ>
                <Champ label={bailF.type === "commercial" && bailF.tva ? "Loyer HT (€)" : "Loyer hors charges (€)"}><input className="in" inputMode="decimal" value={bailF.loyer_hc} onChange={(e) => setBailF({ ...bailF, loyer_hc: e.target.value })} /></Champ>
                <Champ label="Provision pour charges (€)"><input className="in" inputMode="decimal" value={bailF.charges} onChange={(e) => setBailF({ ...bailF, charges: e.target.value })} /></Champ>
                <Champ label="Début du bail"><input className="in" type="date" value={bailF.debut} onChange={(e) => setBailF({ ...bailF, debut: e.target.value })} /></Champ>
                <Champ label={`Trimestre de l'indice (${bailF.type === "commercial" ? NOM_INDICE[bailF.indice as "ilc"] ?? "ILC" : "IRL"})`}><select className="in" value={bailF.irl_trimestre} onChange={(e) => setBailF({ ...bailF, irl_trimestre: e.target.value })}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t}e trimestre</option>)}</select></Champ>
                <Champ label="Dépôt de garantie (€)"><input className="in" inputMode="decimal" value={bailF.depot_garantie} onChange={(e) => setBailF({ ...bailF, depot_garantie: e.target.value })} /></Champ>
                {bailEdite && <Champ label="Fin du bail (départ du locataire)"><input className="in" type="date" value={bailF.fin} onChange={(e) => setBailF({ ...bailF, fin: e.target.value })} /></Champ>}
                <Champ label="Jour de paiement"><input className="in" inputMode="numeric" value={bailF.jour_paiement} onChange={(e) => setBailF({ ...bailF, jour_paiement: e.target.value })} /></Champ>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={enregistrerBail}>Enregistrer le bail</button><button className="btn ghost" onClick={() => { setBailPour(null); setBailEdite(null); setBailF(BAIL_VIDE); }}>Annuler</button></div>
              </div>
            )}
            {bienEdite === b.bien.id ? formBien() : (
              <div className="bien-gestion">
                <button className="link" onClick={() => go("location", b.bien.id)}>Bail et état des lieux</button>
                <button className="link" onClick={() => modifierBien(b.bien)}>Modifier le bien</button>
                {b.bail && <button className="link" onClick={() => modifierBail(b.bail!)}>Modifier le bail</button>}
                {aSupprimer === b.bien.id
                  ? <><button className="link danger" onClick={() => supprimerBien(b.bien.id)}>Confirmer la suppression</button><button className="link" onClick={() => setASupprimer(null)}>Garder</button></>
                  : <button className="link discret" onClick={() => setASupprimer(b.bien.id)}>Supprimer</button>}
              </div>
            )}
          </section>
        );
      })}

      {ajoutBien ? (
        <section className="section">
          {formBien()}
        </section>
      ) : (
        <div className="lire-ligne">
          <LireDocument api={api} espace="locatif" libelle="Lire un bail" toast={toast} onFait={charger} primaire />
          <button className="btn ghost" onClick={() => { setBienEdite(null); setBienF(BIEN_VIDE); setAjoutBien(true); }}>Saisir un bien</button>
        </div>
      )}

      {(d.structures ?? []).length > 0 && <RelevesSci api={api} structures={d.structures ?? []} toast={toast} onFait={charger} />}

      {(r.fiscal.nu || r.fiscal.meuble || r.fiscal.tourisme.length > 0 || r.fiscal.sci.length > 0) && (
        <section className="section">
          <div className="section-head"><h2>Déclaration des loyers</h2></div>
          {r.fiscal.nu && <div className="conseil-fiscal"><b>Location nue · {eur(r.fiscal.nu.recettes)} de loyers par an</b><p>{r.fiscal.nu.conseil}</p><small>Micro-foncier : {eur(r.fiscal.nu.micro.base)} imposés (plafond 15 000 €). Réel : {eur(r.fiscal.nu.reel.resultat)} après {eur(r.fiscal.nu.charges_deductibles)} de charges. {r.fiscal.nu.cases}</small></div>}
          {r.fiscal.tourisme.map((t) => <div className="conseil-fiscal" key={String(t.classe)}><b>Meublé de tourisme {t.classe ? "classé" : "non classé"} · {eur(t.recettes)} sur 12 mois</b><p>{t.conseil}</p><small>Micro-BIC : {eur(t.micro.base)} imposés. Déclaration 2042-C-PRO, rubrique des locations meublées non professionnelles (meublés de tourisme).</small></div>)}
          {r.fiscal.sci.map((x) => <div className="conseil-fiscal sci" key={x.id}><b>{x.nom} · {x.regime === "is" ? "impôt sur les sociétés" : "impôt sur le revenu"}</b><p>{x.conseil}</p><small>Loyers {eur(x.recettes)} · charges {eur(x.charges)} · intérêts {eur(x.interets)}{x.regime === "is" ? ` · amortissement ${eur(x.amortissement)}` : ""} → résultat {eur(x.resultat)}{x.impot_is !== null ? ` · impôt estimé ${eur(x.impot_is)}` : ""}{x.quote_part !== null ? ` · quote-part du foyer ${eur(x.quote_part)}` : ""}.</small></div>)}
          {r.fiscal.meuble && <div className="conseil-fiscal"><b>Location meublée · {eur(r.fiscal.meuble.recettes)} de recettes par an</b><p>{r.fiscal.meuble.conseil}</p><small>Micro-BIC : {eur(r.fiscal.meuble.micro.base)} imposés (plafond {eur(r.fiscal.meuble.seuil)}). {r.fiscal.meuble.cases}</small></div>}
          <p className="note">Estimations sur les loyers des baux en cours, à vérifier chaque année sur impots.gouv.fr. Prélèvements sociaux en plus : 17,2 % sur les loyers nus, 18,6 % sur la location meublée depuis la loi de financement de la sécurité sociale pour 2026. Meublé de tourisme non classé : plafond et abattement différents (15 000 €, 30 %).</p>
        </section>
      )}

      {r.echeances.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>À venir</h2></div>
          <ul className="list">{r.echeances.map((e) => <li key={e.titre}><div className="row-item" style={{ gridTemplateColumns: "auto 1fr" }}><div className="date-chip"><b>{Number(e.date.slice(8, 10))}</b><span>{moisCourt(e.date.slice(0, 7))}</span></div><div><div className="t">{e.titre}</div><div className="s">{e.detail}</div></div></div></li>)}</ul>
        </section>
      )}
      <p className="note">Indices Insee : <a href={SOURCE_IRL} target="_blank" rel="noreferrer">IRL</a>, <a href={SOURCE_INDICE.ilc} target="_blank" rel="noreferrer">ILC</a>, <a href={SOURCE_INDICE.ilat} target="_blank" rel="noreferrer">ILAT</a>. Habitation : quittance gratuite et due à la demande du locataire (loi du 6 juillet 1989, art. 21).</p>
      {doc && <Feuille titre={doc.titre} texte={doc.texte} fichier={doc.fichier} onClose={() => setDoc(null)} />}
    </div>
  );
}

/**
 * Statements of a SCI's bank account (CSV or PDF), e.g. to go further back than the bank connection. The account is
 * kept apart from the household budget (« Location / SCI »); operations already received from the bank are skipped.
 */
function RelevesSci({ api, structures, toast, onFait }: { api: Api; structures: { id: string; nom: string }[]; toast: (m: string) => void; onFait: () => void }) {
  const [comptes, setComptes] = useState<string[]>([]);
  const [choix, setChoix] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.bankStatus().then((s) => setComptes(s.comptes.filter((a) => a.destination === "locatif").map((a) => a.nom))).catch(() => setComptes([])); }, [api]);
  const options = [...comptes, ...structures.map((s) => `Compte ${s.nom}`).filter((n) => !comptes.some((c) => c.toLowerCase().includes(n.slice(7).toLowerCase())))];
  const compte = choix || options[0] || "";
  return (
    <section className="section">
      <div className="section-head"><h2>Relevés de la SCI</h2></div>
      <p className="note" style={{ marginTop: 0 }}>Un relevé CSV ou PDF de la banque de la SCI, par exemple pour remonter plus loin que la connexion bancaire. Il reste à part de votre budget, et les opérations déjà reçues de la banque ne sont pas comptées deux fois.</p>
      {options.length > 1 && <label className="champ"><span>Compte</span><select className="in" value={compte} onChange={(e) => setChoix(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>}
      <label className={`btn ghost import-releve${busy ? " occupe" : ""}`} style={{ marginTop: 8 }}>
        {busy ? "Lecture du relevé…" : `Importer un relevé${options.length === 1 ? ` : ${compte}` : ""}`}
        <input type="file" accept=".csv,.pdf,text/csv,application/pdf" hidden disabled={busy || !compte} onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = "";
          if (!file) return;
          setBusy(true);
          try { const x = await api.importStatement({ file, compte, destination: "locatif" }); toast(`${x.ajoutees} opération${x.ajoutees > 1 ? "s" : ""} ajoutée${x.ajoutees > 1 ? "s" : ""}${x.doublons ? `, ${x.doublons} déjà connue${x.doublons > 1 ? "s" : ""}` : ""}`); onFait(); }
          catch (err) { toast((err as Error).message); }
          finally { setBusy(false); }
        }} />
      </label>
    </section>
  );
}
