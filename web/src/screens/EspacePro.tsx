import { useState } from "react";
import type { Api } from "../api";
import { livreCsv, RUBRIQUES, cleLibelle, type PersonnePro, type Rubrique } from "../../../server/src/viePro";
import { PartageComptablePanneau } from "./Comptable";
import { Alertes, Champ, Chiffres, dateFr, EnTete, eur, moisCourt, telecharger, useEspace, Verrou } from "./espacesCommun";

const RUBRIQUES_CHOIX = (Object.keys(RUBRIQUES) as Rubrique[]).filter((r) => r !== "a_classer");

/** Vie pro : salariés (contrat, bulletins, net imposable) et indépendants (livre, 2035, échéances). */
export function EspacePro({ api, go, onBack, toast }: { api: Api; go: (s: string, id?: string) => void; onBack: () => void; toast: (m: string) => void }) {
  const { data, ferme, err, sauver } = useEspace(api, "pro");
  const [i, setI] = useState(0);
  const [bul, setBul] = useState<{ mois: string; brut: string; net_paye: string; net_imposable: string } | null>(null);
  const [nouveau, setNouveau] = useState<"salarie" | "independant" | null>(null);
  const [form, setForm] = useState({ employeur: "", poste: "", type_contrat: "CDI", date_entree: "", activite: "", regime: "bnc_2035", compte_pro: "" });
  const [voirLivre, setVoirLivre] = useState(false);
  if (ferme) return <Verrou module={ferme} go={go} onBack={onBack} />;
  if (!data) return <div className="screen"><EnTete titre="Vie pro" sous="Chargement…" espace="pro" onBack={onBack} />{err && <p className="note">{err}</p>}</div>;
  const { rapport: r, donnees: d } = data;
  if (!d.personnes.length) return <div className="screen espace"><EnTete titre="Vie pro" sous="Contrats, bulletins, revenus d'indépendant" espace="pro" onBack={onBack} /><p className="note">Ajoutez d'abord les adultes du foyer dans Famille.</p></div>;
  const idx = Math.min(i, d.personnes.length - 1);
  const p = d.personnes[idx], rp = r.personnes[idx];
  const majPersonne = async (np: PersonnePro) => sauver({ personnes: d.personnes.map((x, k) => (k === idx ? np : x)) });

  const ajouterBulletin = async () => {
    if (!bul || !p.salarie) return;
    const n = (s: string) => Number(s.replace(",", "."));
    const b = { mois: bul.mois, brut: n(bul.brut), net_paye: n(bul.net_paye), net_imposable: n(bul.net_imposable) };
    if (!/^\d{4}-\d{2}$/.test(b.mois) || [b.brut, b.net_paye, b.net_imposable].some((x) => !Number.isFinite(x) || x <= 0)) return toast("Mois et trois montants, s'il vous plaît");
    await majPersonne({ ...p, salarie: { ...p.salarie, bulletins: [...p.salarie.bulletins.filter((x) => x.mois !== b.mois), b] } });
    setBul(null); toast("Bulletin ajouté");
  };
  const creer = async () => {
    if (nouveau === "salarie") {
      if (!form.employeur.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.date_entree)) return toast("Employeur et date d'entrée, s'il vous plaît");
      await majPersonne({ ...p, salarie: { employeur: form.employeur.trim(), poste: form.poste.trim(), type_contrat: form.type_contrat as "CDI", date_entree: form.date_entree, bulletins: [] } });
    } else if (nouveau === "independant") {
      if (!form.activite.trim() || !form.compte_pro) return toast("Activité et compte professionnel, s'il vous plaît");
      await majPersonne({ ...p, independant: { activite: form.activite.trim(), regime: form.regime as "bnc_2035", compte_pro: form.compte_pro } });
    }
    setNouveau(null);
  };
  const classer = async (libelle: string, rub: Rubrique) => {
    if (!p.independant) return;
    await majPersonne({ ...p, independant: { ...p.independant, rubriques: { ...(p.independant.rubriques ?? {}), [cleLibelle(libelle)]: rub } } });
    toast(`Classé : ${RUBRIQUES[rub]}`);
  };

  const sal = rp.salarie, ind = rp.independant;
  const annee = new Date().getFullYear();
  const mois12 = Array.from({ length: 12 }, (_, k) => `${annee}-${String(k + 1).padStart(2, "0")}`);
  const ceMois = new Date().toISOString().slice(0, 7);
  const alertes = [
    ...(sal?.manquants.map((m) => ({ niveau: "attention", titre: `Bulletin de ${moisCourt(m)} manquant`, detail: "Demandez-le à votre employeur ou ajoutez-le : il se garde jusqu'à la retraite." })) ?? []),
    ...(sal?.anomalies.map((a) => ({ niveau: "info", titre: `Bulletin de ${moisCourt(a.mois)} à regarder`, detail: a.texte })) ?? []),
    ...(ind?.a_classer.length ? [{ niveau: "attention", titre: `${ind.a_classer.length} dépense${ind.a_classer.length > 1 ? "s" : ""} pro à classer`, detail: "Choisissez la rubrique de la 2035 : Lucien s'en souviendra pour les suivantes." }] : []),
  ];

  return (
    <div className="screen espace">
      <EnTete titre="Vie pro" sous="Salarié ou indépendant : votre carrière et vos revenus en ordre" espace="pro" onBack={onBack} />
      <div className="pills" role="tablist" aria-label="Personne">
        {d.personnes.map((x, k) => <button key={k} role="tab" className="pill" aria-pressed={k === idx} onClick={() => { setI(k); setNouveau(null); setBul(null); }}>{x.prenom}{x.salarie && x.independant ? " · salarié·e et indépendant·e" : x.independant ? " · indépendant·e" : x.salarie ? " · salarié·e" : ""}</button>)}
      </div>
      <Alertes alertes={alertes} />

      {sal && (
        <section className="section">
          <div className="section-head"><h2>Salarié·e</h2><span className="badge">{sal.type_contrat}</span></div>
          <div className="carte-pro">
            <b>{sal.employeur}</b><span>{sal.poste}</span><small>Depuis {sal.anciennete_ans} an{sal.anciennete_ans > 1 ? "s" : ""}{p.salarie?.convention ? ` · convention ${p.salarie.convention}` : ""}</small>
          </div>
          <Chiffres items={[
            { label: `net imposable ${sal.annee}`, valeur: eur(sal.cumul_net_imposable), detail: "à comparer à la déclaration préremplie" },
            { label: "dernier net payé", valeur: eur(sal.dernier?.net_paye), detail: sal.dernier ? moisCourt(sal.dernier.mois) : undefined },
          ]} />
          <div className="bulletins" aria-label="Bulletins de l'année">
            {mois12.map((m) => {
              const b = p.salarie!.bulletins.find((x) => x.mois === m);
              const etat = b ? "ok" : sal.manquants.includes(m) ? "manque" : m >= ceMois ? "avenir" : "hors";
              const verse = sal.verses.find((v) => v.mois === m);
              return <div key={m} className={`bul ${etat}`} title={b ? `Net payé ${eur(b.net_paye)}` : undefined}><span>{moisCourt(m)}</span><b>{b ? eur(b.net_paye) : etat === "manque" ? "manque" : "—"}</b>{verse && <i title={`Versé le ${dateFr(verse.date)}`}>versé</i>}</div>;
            })}
          </div>
          {bul ? (
            <div className="lock form-espace">
              <Champ label="Mois"><input className="in" type="month" value={bul.mois} onChange={(e) => setBul({ ...bul, mois: e.target.value })} /></Champ>
              <Champ label="Salaire brut (€)"><input className="in" inputMode="decimal" value={bul.brut} onChange={(e) => setBul({ ...bul, brut: e.target.value })} /></Champ>
              <Champ label="Net payé (€)"><input className="in" inputMode="decimal" value={bul.net_paye} onChange={(e) => setBul({ ...bul, net_paye: e.target.value })} /></Champ>
              <Champ label="Net imposable (€)"><input className="in" inputMode="decimal" value={bul.net_imposable} onChange={(e) => setBul({ ...bul, net_imposable: e.target.value })} /></Champ>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={ajouterBulletin}>Ajouter</button><button className="btn ghost" onClick={() => setBul(null)}>Annuler</button></div>
            </div>
          ) : <div className="row" style={{ display: "flex", gap: 10, marginTop: 12 }}><button className="btn ghost" onClick={() => setBul({ mois: sal.manquants[0] ?? ceMois, brut: "", net_paye: "", net_imposable: "" })}>Saisir un bulletin</button><button className="btn ghost" onClick={() => go("add")}>Photographier un bulletin</button></div>}
          <p className="note">Bulletins, contrat et avenants se gardent jusqu'à la liquidation de la retraite : ils prouvent vos droits.</p>
        </section>
      )}

      {ind && (
        <section className="section">
          <div className="section-head"><h2>Indépendant·e</h2><span className="badge">{ind.regime === "bnc_2035" ? "BNC · déclaration 2035" : "micro-BNC"}</span></div>
          <div className="carte-pro"><b>{ind.activite}</b><span>Compte {ind.compte_pro}</span><small>Année {ind.annee}, au {dateFr(new Date().toISOString().slice(0, 10))}</small></div>
          <Chiffres items={[
            { label: "recettes encaissées", valeur: eur(ind.recettes), ton: "ok" },
            { label: "dépenses déductibles", valeur: eur(ind.depenses) },
            { label: "bénéfice estimé", valeur: eur(ind.benefice), ton: ind.benefice >= 0 ? "ok" : "alerte" },
            { label: "prélèvements perso", valeur: eur(ind.prelevements), detail: "non déductibles" },
          ]} />
          <div className={`conseil-fiscal ${ind.micro.eligible ? "" : "alerte"}`}><b>Micro ou réel ?</b><p>{ind.micro.conseil}</p><small>Base imposable : {eur(ind.micro.base_reel)} au réel, {eur(ind.micro.base_micro)} en micro (abattement de 34 %). Plafond du micro-BNC : {eur(ind.micro.seuil)} de recettes.</small></div>

          <h3 className="sous-titre">La 2035, rubrique par rubrique</h3>
          <ul className="rubriques">
            {ind.par_rubrique.filter((x) => !["prelevements", "a_classer"].includes(x.rubrique)).map((x) => (
              <li key={x.rubrique} className={x.rubrique === "recettes" ? "recettes" : x.rubrique === "immobilisation" ? "immo" : ""}><span>{x.libelle}<small>{x.nb} opération{x.nb > 1 ? "s" : ""}</small></span><b>{eur(x.montant)}</b></li>
            ))}
          </ul>
          {ind.immobilisations.length > 0 && <p className="note">Achat de plus de 500 € HT ({ind.immobilisations.map((x) => x.libelle.replace(/^CB /, "")).join(", ")}) : il s'amortit sur sa durée d'usage, il ne se déduit pas en une fois. Votre comptable ou votre association de gestion agréée calcule la dotation.</p>}

          {ind.a_classer.length > 0 && (
            <>
              <h3 className="sous-titre">À classer</h3>
              {ind.a_classer.map((t) => (
                <div className="op" key={t.date + t.libelle}><span>{t.libelle}<small>{dateFr(t.date)}</small></span><b>{eur(t.montant, true)}</b>
                  <select className="in mini" defaultValue="" onChange={(e) => e.target.value && classer(t.libelle, e.target.value as Rubrique)} aria-label={`Rubrique pour ${t.libelle}`}><option value="" disabled>Rubrique…</option>{RUBRIQUES_CHOIX.map((k) => <option key={k} value={k}>{RUBRIQUES[k]}</option>)}</select>
                </div>
              ))}
            </>
          )}

          <h3 className="sous-titre">Échéances</h3>
          <ul className="list">{ind.echeances.map((e) => <li key={e.titre}><div className="row-item" style={{ gridTemplateColumns: "auto 1fr" }}><div className="date-chip"><b>{Number(e.date.slice(8, 10))}</b><span>{moisCourt(e.date.slice(0, 7))}</span></div><div><div className="t">{e.titre}</div><div className="s">{e.detail}</div></div></div></li>)}</ul>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setVoirLivre(!voirLivre)}>{voirLivre ? "Masquer le livre" : "Voir le livre des recettes et dépenses"}</button>
            <button className="btn ghost" onClick={() => telecharger(livreCsv(ind), `livre-recettes-depenses-${ind.annee}.csv`)}>Exporter pour le comptable</button>
          </div>
          {voirLivre && (
            <div className="livre">
              {ind.livre.slice().reverse().slice(0, 60).map((l, k) => <div key={k} className={l.montant > 0 ? "rec" : ""}><span>{dateFr(l.date)}</span><span>{l.libelle}<small>{RUBRIQUES[l.rubrique]}</small></span><b>{l.montant > 0 ? "+" : ""}{eur(l.montant, true)}</b></div>)}
            </div>
          )}
          <PartageComptablePanneau api={api} memberId={p.member_id} prenom={p.prenom} toast={toast} />
          <p className="note">Lucien prépare et classe ; la déclaration reste la vôtre (ou celle de votre comptable). Seuils et dates à vérifier chaque année sur impots.gouv.fr.</p>
        </section>
      )}

      {(!p.salarie || !p.independant) && (
        <section className="section">
          {!nouveau ? (
            <div className="pills">
              {!p.salarie && <button className="pill" onClick={() => setNouveau("salarie")}>+ {p.prenom === "Moi" ? "Je suis salarié·e" : `${p.prenom} est salarié·e`}</button>}
              {!p.independant && <button className="pill" onClick={() => { setNouveau("independant"); setForm({ ...form, compte_pro: data.comptes[0] ?? "" }); }}>+ {p.prenom === "Moi" ? "J'ai une activité d'indépendant" : `${p.prenom} a une activité d'indépendant`}</button>}
            </div>
          ) : (
            <div className="lock form-espace">
              {nouveau === "salarie" ? (
                <>
                  <Champ label="Employeur"><input className="in" value={form.employeur} onChange={(e) => setForm({ ...form, employeur: e.target.value })} /></Champ>
                  <Champ label="Poste"><input className="in" value={form.poste} onChange={(e) => setForm({ ...form, poste: e.target.value })} /></Champ>
                  <Champ label="Contrat"><select className="in" value={form.type_contrat} onChange={(e) => setForm({ ...form, type_contrat: e.target.value })}>{["CDI", "CDD", "interim", "apprentissage", "autre"].map((x) => <option key={x}>{x}</option>)}</select></Champ>
                  <Champ label="Date d'entrée"><input className="in" type="date" value={form.date_entree} onChange={(e) => setForm({ ...form, date_entree: e.target.value })} /></Champ>
                </>
              ) : (
                <>
                  <Champ label="Activité"><input className="in" value={form.activite} onChange={(e) => setForm({ ...form, activite: e.target.value })} placeholder="Infirmière libérale, graphiste, consultant…" /></Champ>
                  <Champ label="Régime"><select className="in" value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}><option value="bnc_2035">BNC, déclaration contrôlée (2035)</option><option value="micro_bnc">Micro-BNC</option></select></Champ>
                  <Champ label="Compte professionnel"><select className="in" value={form.compte_pro} onChange={(e) => setForm({ ...form, compte_pro: e.target.value })}>{data.comptes.length ? data.comptes.map((c) => <option key={c}>{c}</option>) : <option value="">Connectez d'abord la banque</option>}</select></Champ>
                </>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={creer}>Enregistrer</button><button className="btn ghost" onClick={() => setNouveau(null)}>Annuler</button></div>
            </div>
          )}
        </section>
      )}

      {r.papiers.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Papiers pro du coffre</h2></div>
          <ul className="list">{r.papiers.map((x) => <li key={x.id}><button className="row-item" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => go("doc", x.id)}><div><div className="t">{x.title}</div><div className="s">{{ contrat: "Contrat", avenant: "Avenant", bulletin: "Bulletin de salaire", attestation: "Attestation" }[x.type]}</div></div><span /></button></li>)}</ul>
        </section>
      )}
    </div>
  );
}
