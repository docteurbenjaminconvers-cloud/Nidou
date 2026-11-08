import { ConfirmationPaiement } from "./Confirmation";
import { Ico } from "./espacesCommun";
import { useEffect, useState } from "react";
import type { Api, Partenaire, SujetSupport } from "../api";
import { ApiError } from "../api";
import type { Household } from "../types";
import { Back, SITE } from "../ui";
import { choisirLangue, langueChoisie } from "../i18n/traduction";

/** « Le point du dimanche » : la semaine de Lucien, chaque dimanche soir (notification, et email avec la formule complète). */
function PointDimanche({ api, household, onChanged, toast, go }: { api: Api; household: Household; onChanged: () => void; toast: (m: string) => void; go: (s: string, id?: string) => void }) {
  const [on, setOn] = useState(household.hebdo !== false);
  const basculer = async () => {
    const v = !on; setOn(v);
    try { await api.setHebdo(v); onChanged(); toast(v ? "Le point du dimanche est activé" : "Plus de point du dimanche"); } catch (e) { setOn(!v); toast((e as Error).message && !/^Erreur /.test((e as Error).message) ? (e as Error).message : "Réglage non enregistré, réessayez"); }
  };
  return (
    <div className="settings-row">
      <div><div className="t">Le point du dimanche</div><div className="s">Chaque dimanche soir : échéances, agenda des enfants, économies et un conseil{household.plan === "famille" ? ", par notification et par email" : ", par notification"}. <button className="link" onClick={() => go("semaine")}>Voir ma semaine</button></div></div>
      <button className="toggle" role="switch" aria-checked={on} aria-label="Le point du dimanche" onClick={basculer} />
    </div>
  );
}

/** Accounts sharing this household: invite a partner by email, see who is in, remove. */
function FamillePartagee({ api, household, toast }: { api: Api; household: Household; toast: (m: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<Api["comptes"]>> | null>(null);
  const [email, setEmail] = useState(""); const [prenom, setPrenom] = useState(""); const [busy, setBusy] = useState(false); const [lien, setLien] = useState<string | null>(null);
  const load = () => api.comptes().then(setData).catch(() => setData({ comptes: [], invitations: [] }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const owner = !household.utilisateur || data?.comptes.find((c) => c.id === household.utilisateur?.id)?.role === "proprietaire";
  const invite = async () => {
    setBusy(true);
    try { const r = await api.inviter(email.trim(), prenom.trim() || null); setLien(r.lien); toast(r.envoye ? `Invitation envoyée à ${email}` : "Invitation créée"); setEmail(""); setPrenom(""); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "L'invitation a échoué"); }
    finally { setBusy(false); }
  };
  const [ouvrir, setOuvrir] = useState(false);
  return (
    <div className="reg-sous">
      <div className="reg-sous-tete"><b>Comptes connectés</b>{data && <span className="badge">{data.comptes.length} / {household.capacite_comptes ?? "?"}</span>}</div>
      <p className="note">Chacun ouvre le même foyer sur son téléphone : mêmes papiers, mêmes rappels, même budget.</p>
      {data?.comptes.map((c) => (
        <div className="settings-row" key={c.id}><div><div className="t">{c.prenom ?? c.email}{household.utilisateur?.id === c.id ? " (vous)" : ""}</div><div className="s">{c.email} · {c.role === "proprietaire" ? "propriétaire du foyer" : "membre"}</div></div>{owner && household.utilisateur?.id !== c.id && c.role !== "proprietaire" && <button className="link discret" onClick={async () => { if (confirm(`Retirer ${c.prenom ?? c.email} du foyer ?`)) { await api.retirerCompte(c.id); toast("Compte retiré"); load(); } }}>Retirer</button>}</div>
      ))}
      {data?.invitations.map((i) => (
        <div className="settings-row" key={i.id}><div><div className="t">{i.prenom ?? i.email}</div><div className="s">{i.email} · invitation en attente</div></div><button className="link" onClick={async () => { await api.annulerInvitation(i.id); load(); }}>Annuler</button></div>
      ))}
      {!ouvrir ? <button className="pill-action" style={{ marginTop: 10 }} onClick={() => setOuvrir(true)}><Ico d="M12 5v14M5 12h14" />Inviter quelqu'un</button> : (
        <div className="reg-invite">
          <input className="in" placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          <input className="in" type="email" inputMode="email" placeholder="email@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={invite}>{busy ? <span className="spinner" /> : "Envoyer l'invitation"}</button>
          {lien && <p className="note">Mode développement, lien à transmettre : <a className="link" href={lien}>{lien}</a></p>}
          <p className="note">{household.plan === "gratuit" ? "Sans abonnement, un seul compte reste connecté. Duo : 2 personnes, Tribu : jusqu’à 6." : (household.capacite_comptes ?? 6) < 6 ? `Votre formule accepte ${household.capacite_comptes} personne${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} connectée${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} ; Tribu va jusqu'à 6.` : "Jusqu'à 6 personnes connectées."}</p>
        </div>
      )}
    </div>
  );
}

type Formule = "solo" | "duo" | "tribu";
const TIERS: { id: Formule; nom: string; comptes: number; prix: { mensuel: number; annuel: number }; pour: string }[] = [
  { id: "solo", nom: "Solo", comptes: 1, prix: { mensuel: 6.9, annuel: 69 }, pour: "pour vous seul·e" },
  { id: "duo", nom: "Duo", comptes: 2, prix: { mensuel: 9.9, annuel: 99 }, pour: "vous et votre conjoint·e" },
  { id: "tribu", nom: "Tribu", comptes: 6, prix: { mensuel: 13.9, annuel: 139 }, pour: "toute la famille, ados et grands-parents" },
];
const fmtPrix = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;
const ROLE_LABEL: Record<string, string> = { adulte: "adulte", enfant: "enfant", parent_a_charge: "parent à charge", autre_a_charge: "personne à charge" };

export function Settings({ api, household, onBack, onPlan, toast, go }: { api: Api; household: Household; onBack: () => void; onPlan: (p: Household["plan"]) => void; toast: (m: string) => void; go: (s: string, id?: string) => void }) {
  const mcpUrl = `${location.origin}/mcp`;
  const [suppression, setSuppression] = useState(false);
  const [aide, setAide] = useState(false);
  const [periode, setPeriode] = useState<"mensuel" | "annuel">(household.abonnement?.periode ?? "annuel");
  const [apercu, setApercu] = useState<{ a: NonNullable<Awaited<ReturnType<Api["changerFormule"]>>["apercu"]>; formule: Formule; periode: "mensuel" | "annuel" } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const comptes = household.comptes ?? 1;
  const formuleActuelle = household.plan_souscrit === "famille" || household.abonnement?.statut === "simule" ? household.abonnement?.formule ?? null : null;
  const conseil: Formule = comptes >= 3 ? "tribu" : "duo";
  const [demarrage, setDemarrage] = useState(false);
  // a running subscription changes formule (amount shown first); otherwise a new subscription goes through Checkout
  const enCours = !!formuleActuelle && ["active", "trialing", "simule"].includes(household.abonnement?.statut ?? "");
  const changer = async (formule: Formule, p: "mensuel" | "annuel", confirmer = false) => {
    setEnvoi(true);
    try {
      const r = await api.changerFormule(formule, p, confirmer ? { confirmer: true, proration_date: apercu?.a.proration_date } : {});
      if (r.apercu) { setApercu({ a: r.apercu, formule, periode: p }); return; }
      setApercu(null);
      if (r.url) { location.href = r.url; return; }
      if (r.attente) { toast("Le paiement n'est pas passé : rien n'a changé. Vérifiez votre carte dans « Gérer mon abonnement »."); return; }
      toast(r.prevu ? `C'est noté : Lucien ${TIERS.find((t) => t.id === r.prevu!.formule)!.nom} à partir du ${dateFr(r.prevu.le)}` : `C'est fait : Lucien ${TIERS.find((t) => t.id === formule)!.nom}`);
      onPlan("famille");
    } catch (e) { toast((e as Error).message); } finally { setEnvoi(false); }
  };
  const checkout = async (formule: Formule, p: "mensuel" | "annuel") => {
    if (enCours) return changer(formule, p);
    if (!formuleActuelle && !demarrage) { toast("Cochez d'abord la case sur le démarrage de l'abonnement."); return; }
    try {
      const r = await api.checkout(formule, p, true);
      if (r.url) { location.href = r.url; return; }
      onPlan("famille"); toast(`Formule ${TIERS.find((t) => t.id === formule)!.nom} activée (démo)`);
    } catch (e) { toast((e as Error).message); }
  };
  const abo = household.abonnement;
  const offert = abo?.statut === "offert";
  const essai = !!household.essai?.actif && !formuleActuelle && !offert;
  const nomFormule = TIERS.find((t) => t.id === formuleActuelle)?.nom;
  const paye = abo?.statut === "active" || abo?.statut === "simule" || abo?.statut === "past_due";
  const [formules, setFormules] = useState(!formuleActuelle && !offert && household.plan === "gratuit" && !household.essai?.actif);
  const [connecteur, setConnecteur] = useState(false);
  const statut = offert ? { titre: "Accès offert", sous: "Tout Lucien et tous les modules pendant l'avant-première, sans carte bancaire." }
    : formuleActuelle ? { titre: `Lucien ${nomFormule ?? ""}`, sous: `Paiement ${abo?.periode === "annuel" ? "annuel" : "mensuel"}${abo?.fin ? ` · ${abo.abonnement_resilie ? "s'arrête le" : "prochaine échéance le"} ${dateFr(abo.fin)}` : ""}${abo?.statut === "past_due" ? " · paiement en attente : mettez à jour votre carte" : ""}${abo?.statut === "simule" ? " · simulé" : ""}` }
    : essai ? { titre: `Essai gratuit · ${(household.essai!.jours_restants ?? 0)} jour${(household.essai!.jours_restants ?? 0) > 1 ? "s" : ""}`, sous: "Tout Lucien, jusqu'à 6 personnes, sans carte bancaire. Ensuite, choisissez une formule." }
    : { titre: "Sans abonnement", sous: "Vos papiers et vos échéances restent consultables et exportables. Lucien ne range plus rien de nouveau." };
  const copier = async (t: string, ok: string) => { try { await navigator.clipboard.writeText(t); toast(ok); } catch { toast(t); } };
  const initiales = (household.utilisateur?.prenom ?? household.utilisateur?.email ?? household.nom).trim().slice(0, 1).toUpperCase();
  return (
    <div className="screen tableau reglages">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Réglages</h1>{api.mode === "demo" && <p className="sub">mode démo</p>}</div></div>

      {/* ---------- Vous et le foyer ---------- */}
      <section className="section reg-carte reg-profil">
        <span className="reg-avatar" aria-hidden>{initiales}</span>
        <div className="reg-profil-texte">
          <b>{household.utilisateur?.prenom ?? household.utilisateur?.email ?? "Vous"}</b>
          {household.utilisateur?.email && <span>{household.utilisateur.email}</span>}
          <button className="reg-foyer" onClick={async () => { const n = prompt("Nom du foyer", household.nom); if (n && n.trim()) { await api.renommer(n.trim()); onPlan(household.plan); } }}>Foyer « {household.nom} » <Ico d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={15} /></button>
        </div>
        {household.utilisateur && <button className="pill-action" onClick={async () => { await api.deconnexion(); location.reload(); }}>Se déconnecter</button>}
      </section>

      {/* ---------- Abonnement ---------- */}
      <section className={`section reg-carte reg-abo ${formules && !offert ? "large" : ""}`}>
        <p className="reg-titre">Abonnement</p>
        <div className="reg-statut">
          <div><b>{statut.titre}</b><span>{statut.sous}</span></div>
          {essai && <span className="badge">essai</span>}{formuleActuelle && !abo?.abonnement_resilie && <span className="badge">actif</span>}{abo?.abonnement_resilie && <span className="badge yolk">résilié</span>}
        </div>
        {abo?.changement_prevu && (
          <div className="resil-note"><span>Passage à Lucien {TIERS.find((t) => t.id === abo.changement_prevu!.formule)!.nom}, paiement {abo.changement_prevu.periode}, prévu le {dateFr(abo.changement_prevu.le)}.</span>
            <div className="actions-abo"><button className="pill-action" onClick={async () => { try { await api.annulerChangementFormule(); toast("Changement annulé"); onPlan("famille"); } catch (e) { toast((e as Error).message); } }}>Annuler ce changement</button></div></div>
        )}
        <div className="actions-abo">
          {!offert && <button className={`pill-action ${formules ? "actif" : ""}`} aria-expanded={formules} onClick={() => setFormules(!formules)}><Ico d="M4 6h16M4 12h16M4 18h10" />{formuleActuelle ? "Changer de formule" : "Choisir une formule"}</button>}
          <button className="pill-action" onClick={() => go("offre")}><Ico d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7" />Modules et packs</button>
          {paye && abo?.gerable && <button className="pill-action" onClick={async () => { const r = await api.portail(); location.href = r.url; }}><Ico d="M3 7h18v10H3zM3 11h18M7 15h3" />Carte et factures</button>}
          {paye && <Resiliation api={api} household={household} toast={toast} />}
          {paye && <Retractation api={api} household={household} toast={toast} />}
        </div>
        {api.mode === "demo" && household.plan !== "gratuit" && <button className="link" style={{ marginTop: 10 }} onClick={() => { api.setPlan("gratuit"); onPlan("gratuit"); toast("Fin d'essai simulée"); }}>Simuler la fin de l'essai (démo)</button>}

        {formules && !offert && (
          <div className="reg-formules">
            <div className="pills" role="group" aria-label="Période">
              <button className="pill" aria-pressed={periode === "annuel"} onClick={() => setPeriode("annuel")}>Annuel · 2 mois offerts</button>
              <button className="pill" aria-pressed={periode === "mensuel"} onClick={() => setPeriode("mensuel")}>Mensuel</button>
            </div>
            {abo?.paiement === false && <p className="note reg-info">Le paiement en ligne arrive bientôt. D'ici là, votre essai et vos papiers restent tels quels.</p>}
            <div className="tiers">
              {TIERS.map((t) => {
                const actuel = formuleActuelle === t.id && (!enCours || abo?.periode === periode);
                const memeFormule = formuleActuelle === t.id && !actuel;
                const tropPetite = comptes > t.comptes;
                const prix = t.prix[periode];
                return (
                  <div key={t.id} className={`plan-card tier ${actuel ? "on" : ""} ${t.id === conseil && !formuleActuelle ? "conseil" : ""}`}>
                    {t.id === conseil && !formuleActuelle && <span className="tier-tag">{comptes >= 2 ? "Pour votre foyer" : "Le plus choisi"}</span>}
                    <div className="tier-head"><h3>{t.nom}</h3><span className="tier-people">{t.comptes === 1 ? "1 personne" : t.comptes === 2 ? "2 personnes" : "jusqu'à 6 personnes"}</span></div>
                    <div className="tier-price"><b>{fmtPrix(prix)}</b><span>{periode === "annuel" ? " / an" : " / mois"}</span></div>
                    <p className="note">{periode === "annuel" ? `soit ${fmtPrix(prix / 12)} par mois` : `ou ${fmtPrix(t.prix.annuel)} par an`} · {t.pour}</p>
                    {actuel ? <span className="badge" style={{ marginTop: 10 }}>votre formule</span>
                      : tropPetite ? <p className="note" style={{ marginTop: 8 }}>{comptes} personnes se connectent déjà à ce foyer.</p>
                      : abo?.paiement === false ? null
                      : <button className={`btn block ${t.id === conseil ? "" : "ghost"}`} style={{ marginTop: 10 }} onClick={() => checkout(t.id, periode)}>{memeFormule ? `Passer au paiement ${periode}` : formuleActuelle ? `Passer à ${t.nom}` : `Choisir ${t.nom}`}</button>}
                  </div>
                );
              })}
            </div>
            <p className="note">Chaque formule comprend tout Lucien ; elles diffèrent par le nombre de personnes qui se connectent. Les enfants et parents sans connexion sont illimités.{formuleActuelle ? " Une formule plus grande est payée tout de suite, au prorata ; une plus petite ou un autre rythme commence à votre échéance, sans remboursement." : ""}</p>
            {!formuleActuelle && abo?.paiement !== false && <ConsentementDemarrage coche={demarrage} onChange={setDemarrage} />}
            {!formuleActuelle && <CodePartenaire api={api} toast={toast} />}
            {!formuleActuelle && <details className="reg-repli"><summary>Et sans abonnement, après l'essai ?</summary><ul><li>Vos papiers et vos échéances restent consultables et exportables</li><li>Les rappels d'échéances continuent (notifications)</li><li>Pas de nouveau papier, ni lecture par l'IA, ni banque, ni modules</li><li>Un seul compte reste connecté</li></ul></details>}
          </div>
        )}
        {apercu && <ConfirmationPaiement apercu={apercu.a} periode={apercu.periode} envoi={envoi} titre="Changer de formule" nouveau={`Lucien ${TIERS.find((t) => t.id === apercu.formule)!.nom}, paiement ${apercu.periode},`} onAnnuler={() => setApercu(null)} onConfirmer={() => changer(apercu.formule, apercu.periode, true)} />}
      </section>

      {/* ---------- Foyer ---------- */}
      <section className="section reg-carte">
        <p className="reg-titre">Le foyer</p>
        <div className="reg-membres">
          {household.membres.map((m) => <span key={m.id} className="reg-membre"><b>{m.prenom}</b><small>{ROLE_LABEL[m.role] ?? m.role}</small></span>)}
        </div>
        <button className="pill-action" style={{ marginTop: 10 }} onClick={() => go("famille")}><Ico d="M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9" />Gérer la famille</button>
        <FamillePartagee api={api} household={household} toast={toast} />
      </section>

      {/* ---------- Lucien au quotidien ---------- */}
      <section className="section reg-carte">
        <p className="reg-titre">Lucien au quotidien</p>
        <PointDimanche api={api} household={household} onChanged={() => onPlan(household.plan)} toast={toast} go={go} />

        <div className="settings-row">
          <div><div className="t">Papiers par email {household.boite_email ? <span className="badge">actif</span> : <span className="badge yolk">{household.boite_bientot ? "bientôt" : "formule"}</span>}</div>
            <div className="s">{household.boite_email ? "Transférez une facture ou un contrat à votre adresse Lucien : il se range tout seul et crée ses rappels." : household.boite_bientot ? "Votre adresse personnelle arrive bientôt. En attendant, ajoutez vos papiers avec le bouton +." : "Une adresse personnelle pour transférer vos papiers, avec une formule."}</div></div>
          {household.boite_email && <button className="link" onClick={() => copier(household.boite_email!, "Adresse copiée")}>Copier</button>}
        </div>
        {household.boite_email && <div className="code reg-code">{household.boite_email}</div>}

        <div className="settings-row">
          <div><div className="t">Demander à Lucien {household.assistant?.option ? <span className="badge">option active</span> : household.assistant?.acces === "essai" ? <span className="badge">essai</span> : <span className="badge yolk">option</span>}</div>
            <div className="s">{household.assistant?.option ? `${household.assistant.restantes} questions restantes ce mois-ci, sur ${household.assistant.quota}` : household.assistant?.acces === "essai" ? `${household.assistant.restantes} questions offertes pendant l'essai` : `${fmtPrix(household.assistant?.prix.mensuel ?? 2.9)} par mois : vos questions, directement dans Lucien`}</div></div>
          <div className="reg-liens">
            <button className="link" onClick={() => go("assistant")}>Ouvrir</button>
            {household.assistant?.option
              ? <button className="link discret" onClick={async () => { if (!confirm("Retirer l'option assistant ? Elle reste ouverte jusqu'à votre échéance, sans remboursement.")) return; try { await api.assistantOption(false); onPlan(household.plan); toast("Option retirée"); } catch (e) { toast((e as Error).message); } }}>Retirer</button>
              : household.plan === "famille" && <button className="link" onClick={async () => { if (api.mode !== "demo") { go("offre", "assistant"); return; } try { await api.assistantOption(true); onPlan(household.plan); toast("Assistant activé"); } catch (e) { toast((e as Error).message); } }}>Ajouter</button>}
          </div>
        </div>

        <div className="settings-row">
          <div><div className="t">Connecteur Claude ou ChatGPT {household.plan === "famille" ? <span className="badge">actif</span> : <span className="badge yolk">formule</span>}</div>
            <div className="s">Votre assistant IA consulte vos papiers en lecture seule ; la banque n'est jamais lue, chaque accès est journalisé.</div></div>
          <div className="reg-liens">
            <button className="link" onClick={() => go("connecteur")}>Le tuto</button>
            {household.mcp_token && <button className="link" aria-expanded={connecteur} onClick={() => setConnecteur(!connecteur)}>{connecteur ? "Masquer" : "Mon adresse"}</button>}
          </div>
        </div>
        {connecteur && household.mcp_token && (
          <div className="reg-sous">
            <div className="code reg-code" style={{ wordBreak: "break-all" }}>{mcpUrl}/{household.mcp_token}</div>
            <p className="note">À coller dans Claude ou ChatGPT. Gardez-la pour vous : elle ouvre vos papiers. Pour un outil avec en-tête d'autorisation (Claude Desktop, Cursor) : {mcpUrl} et « Bearer » suivi du jeton.</p>
            <div className="actions-abo">
              <button className="pill-action" onClick={() => copier(`${mcpUrl}/${household.mcp_token}`, "Adresse copiée")}>Copier l'adresse</button>
              <button className="pill-action" onClick={async () => { const t = await api.regenererMcp(); toast("Nouvelle adresse : " + t.slice(0, 6) + "…"); onPlan(household.plan); }}>Changer l'adresse</button>
            </div>
          </div>
        )}
      </section>

      {/* ---------- Aide et données ---------- */}
      <section className="section reg-carte">
        <p className="reg-titre">Aide et données</p>
        <div className="settings-row"><div><div className="t">Une question, un souci, une idée</div><div className="s">Réponse par email sous 48 h ouvrées{household.assistant && household.assistant.acces !== "aucun" ? ", ou tout de suite avec « Demander à Lucien »" : ""}</div></div><button className="link" onClick={() => setAide(true)}>Écrire</button></div>
        <div className="settings-row"><div><div className="t">Langue de l'appli</div><div className="s">Language of the app</div></div>
          <select className="in langue-choix" aria-label="Langue / Language" value={langueChoisie()} onChange={(e) => choisirLangue(e.target.value as "fr" | "en")} data-pas-traduire>
            <option value="fr">Français</option><option value="en">English</option>
          </select></div>
        <div className="settings-row"><div><div className="t">Exporter tout</div><div className="s">Vos papiers d'origine et toutes vos données, dans un fichier .zip</div></div><button className="link" onClick={async () => { toast("Préparation de l'export…"); try { await api.exporter(); } catch (e) { toast((e as Error).message); } }}>Exporter</button></div>
        {abo?.suppression_le && household.titulaire !== false ? (
          <div className="settings-row suppr-prevue"><div><div className="t">Suppression prévue le {dateFr(abo.suppression_le)}</div><div className="s">Tout reste accessible d'ici là. Pensez à exporter vos données.</div></div><button className="link" onClick={async () => { try { await api.annulerSuppression(); toast("Suppression annulée, l'abonnement continue"); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Annuler</button></div>
        ) : <div className="settings-row"><div><div className="t">Supprimer le compte</div><div className="s">{household.titulaire === false ? "Vous quittez le foyer, votre compte est effacé" : "Le foyer est effacé à la fin de la période déjà payée"}</div></div><button className="link" style={{ color: "var(--ember)" }} onClick={() => setSuppression(true)}>Supprimer</button></div>}
        <p className="note reg-pied">Hébergé en Europe · connexion chiffrée · vos données ne sont jamais revendues.</p>
      </section>
      {aide && <EcrireEquipe api={api} formule={abo?.formule ?? null} email={household.utilisateur?.email ?? null} onClose={() => setAide(false)} toast={toast} />}
      {suppression && <SuppressionCompte api={api} titulaire={household.titulaire !== false} foyer={household.nom} paye={paiementEnCours(household)} fin={abo?.fin ?? null} onClose={() => setSuppression(false)} toast={toast} />}
    </div>
  );
}

/** The accountant's partner code: first month free on the first subscription. */
export const CLE_PARTENAIRE = "lucien.partenaire";
function CodePartenaire({ api, toast }: { api: Api; toast: (m: string) => void }) {
  const [p, setP] = useState<Partenaire | null>(null);
  const [saisie, setSaisie] = useState("");
  useEffect(() => { api.partenaire().then(setP).catch(() => setP({ code: null, cabinet: null, offert: null })); }, [api]);
  const valider = async (code: string | null) => {
    try { const r = await api.setPartenaire(code); setP(r); setSaisie(""); toast(r.code ? "Code partenaire enregistré" : "Code retiré"); }
    catch (e) { toast((e as Error).message); }
  };
  if (!p) return null;
  return (
    <div className="partenaire-bloc">
      {p.cabinet ? (
        <>
          <b>Code partenaire · {p.cabinet.nom}{p.cabinet.ville ? `, ${p.cabinet.ville}` : ""}</b>
          <span>{p.offert} : il s'appliquera au moment de vous abonner.</span>
          <button className="link" onClick={() => valider(null)}>Retirer le code</button>
        </>
      ) : (
        <>
          <b>Votre comptable vous a donné un code ?</b>
          <span>Avec le code d'un cabinet partenaire, le premier mois de votre abonnement est offert.</span>
          <form onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) valider(saisie.trim()); }}>
            <input value={saisie} onChange={(e) => setSaisie(e.target.value.toUpperCase())} placeholder="ex. CABI-7K2P" aria-label="Code partenaire" maxLength={20} autoCapitalize="characters" />
            <button className="btn" type="submit" disabled={!saisie.trim()}>Valider</button>
          </form>
        </>
      )}
    </div>
  );
}

const dateFr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
/** A paid subscription is running (trial and the free plan are not). */
const paiementEnCours = (h: Household) => ["active", "trialing", "past_due", "simule"].includes(h.abonnement?.statut ?? "");

/** The consumer's express request for an immediate start (withdrawal right, Code de la consommation L221-25). */
export function ConsentementDemarrage({ coche, onChange }: { coche: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="consentement">
      <input type="checkbox" checked={coche} onChange={(e) => onChange(e.target.checked)} />
      <span>Je demande que mon abonnement commence tout de suite. Je garde 14 jours pour me rétracter ; seuls les jours déjà utilisés seront alors retenus.</span>
      <small className="consentement-cgv">En payant, vous acceptez les <a href={`${SITE}/cgv.html`} target="_blank" rel="noreferrer">conditions générales de vente</a> et les <a href={`${SITE}/cgu.html`} target="_blank" rel="noreferrer">conditions d'utilisation</a>.</small>
    </label>
  );
}

/** « Me rétracter » : 14 days after a new paid subscription. */
function Retractation({ api, household, toast }: { api: Api; household: Household; toast: (m: string) => void }) {
  const r = household.abonnement?.retractation;
  const [confirmer, setConfirmer] = useState(false);
  if (!r?.possible || household.titulaire === false) return null;
  return confirmer ? (
    <div className="resil-note"><span>L'abonnement s'arrête tout de suite et vous êtes remboursé de ce que vous avez payé, moins les jours déjà utilisés. Vos papiers restent consultables.</span>
      <div className="actions-abo"><button className="pill-action danger" onClick={async () => { try { const x = await api.seRetracter(); toast(x.rembourse_centimes ? `Rétractation faite : ${(x.rembourse_centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € remboursés sous quelques jours` : "Rétractation faite"); setTimeout(() => location.reload(), 1500); } catch (e) { toast((e as Error).message); } }}>Confirmer la rétractation</button><button className="pill-action" onClick={() => setConfirmer(false)}>Garder</button></div></div>
  ) : <button className="pill-action" onClick={() => setConfirmer(true)}><Ico d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />Me rétracter · jusqu'au {r.jusquau ? dateFr(r.jusquau) : "14e jour"}</button>;
}

/** « Résilier l'abonnement » : no renewal, active until the end of the period already paid; can be taken back. */
function Resiliation({ api, household, toast }: { api: Api; household: Household; toast: (m: string) => void }) {
  const a = household.abonnement;
  const [confirmer, setConfirmer] = useState(false);
  if (!a || !paiementEnCours(household) || household.titulaire === false || a.suppression_le) return null;
  if (a.abonnement_resilie) return (
    <div className="resil-note"><span>Abonnement résilié : il reste actif jusqu'au {a.fin ? dateFr(a.fin) : "terme de la période"}, puis s'arrête sans autre prélèvement.</span>
      <button className="pill-action" onClick={async () => { try { await api.reprendre(); toast("Abonnement repris"); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Reprendre l'abonnement</button></div>
  );
  return confirmer ? (
    <div className="resil-note"><span>L'abonnement ne sera pas renouvelé. Il reste actif jusqu'au {a.fin ? dateFr(a.fin) : "terme de la période déjà payée"}, sans remboursement ; vos papiers restent ensuite consultables.</span>
      <div className="actions-abo"><button className="pill-action danger" onClick={async () => { try { const r = await api.resilier(); toast(`Résilié : actif jusqu'au ${dateFr(r.fin)}`); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Confirmer la résiliation</button><button className="pill-action" onClick={() => setConfirmer(false)}>Garder</button></div></div>
  ) : <button className="pill-action danger" onClick={() => setConfirmer(true)}><Ico d="M18 6L6 18M6 6l12 12" />Résilier</button>;
}

/** Confirmation sheet for « Supprimer le compte »: what goes, the export first, then SUPPRIMER typed by hand. */
function SuppressionCompte({ api, titulaire, foyer, paye, fin, onClose, toast }: { api: Api; titulaire: boolean; foyer: string; paye: boolean; fin: string | null; onClose: () => void; toast: (m: string) => void }) {
  const [mot, setMot] = useState("");
  const [immediat, setImmediat] = useState(false);
  const [busy, setBusy] = useState(false);
  const aEcheance = titulaire && paye && !immediat;
  const valider = async () => {
    setBusy(true);
    try {
      const r = await api.supprimerCompte(mot, immediat);
      if (r.le) { toast(`Le foyer sera supprimé le ${dateFr(r.le)}`); setTimeout(() => location.reload(), 1500); return; }
      toast(r.portee === "foyer" ? "Foyer supprimé." : "Votre compte est supprimé.");
      setTimeout(() => { location.hash = ""; location.reload(); }, 1800);
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <div className="feuille-fond" onClick={onClose}>
      <div className="feuille" role="dialog" aria-modal="true" aria-label="Supprimer le compte" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="feuille-tete"><b>{titulaire ? `Supprimer le foyer « ${foyer} »` : "Quitter le foyer et supprimer mon compte"}</b><button className="link" onClick={onClose}>Annuler</button></div>
        {titulaire ? (
          <ul className="suppr-liste">
            {paye
              ? <li>L'abonnement n'est pas renouvelé et rien n'est remboursé. {immediat ? "Le reste de la période déjà payée est perdu." : `Le foyer reste accessible jusqu'au ${fin ? dateFr(fin) : "terme de la période déjà payée"}, puis il est effacé ; vous pouvez changer d'avis d'ici là.`}</li>
              : <li>Aucun abonnement payant n'est en cours : le foyer est effacé tout de suite.</li>}
            <li>Seront effacés : papiers, fichiers, photos, échéances, opérations bancaires et modules, pour toutes les personnes du foyer. L'accès à votre banque est coupé.</li>
            <li>Les autres personnes connectées au foyer sont prévenues par email. Vos factures restent disponibles chez notre prestataire de paiement, comme la loi l'impose.</li>
          </ul>
        ) : (
          <ul className="suppr-liste">
            <li>Votre compte et vos sessions sont effacés, et vous n'avez plus accès au foyer.</li>
            <li>Le foyer, ses papiers et son abonnement restent en place pour les autres.</li>
          </ul>
        )}
        {titulaire && paye && <label className="suppr-option"><input type="checkbox" checked={immediat} onChange={(e) => setImmediat(e.target.checked)} /> Tout effacer dès maintenant (le reste de la période payée est perdu)</label>}
        <button className="btn ghost block" onClick={async () => { try { await api.exporter(); } catch (e) { toast((e as Error).message); } }}>Exporter mes données d'abord</button>
        <label className="champ" style={{ marginTop: 14 }}><span>Pour confirmer, tapez SUPPRIMER</span><input value={mot} onChange={(e) => setMot(e.target.value)} autoCapitalize="characters" autoComplete="off" aria-label="Tapez SUPPRIMER pour confirmer" /></label>
        <button className="btn block danger" style={{ marginTop: 12 }} disabled={busy || mot.trim().toUpperCase() !== "SUPPRIMER"} onClick={valider}>{busy ? <span className="spinner" /> : !titulaire ? "Supprimer mon compte" : aEcheance ? `Supprimer le ${fin ? dateFr(fin) : "à l'échéance"}` : "Supprimer définitivement"}</button>
      </div>
    </div>
  );
}

const SUJETS: [SujetSupport, string][] = [["question", "Une question"], ["probleme", "Quelque chose ne marche pas"], ["banque", "Connexion à ma banque"], ["abonnement", "Abonnement, facture, résiliation"], ["idee", "Une idée, une suggestion"]];

/** The technical details joined to a message, shown in full before sending so the person knows what leaves. */
function infosTechniques() {
  const ua = navigator.userAgent;
  const appareil = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? "iPad" : "iPhone") : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Autre";
  const nav = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Edg/.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "navigateur";
  const installee = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone ? "appli installée" : "dans le navigateur";
  let page = "réglages"; try { page = sessionStorage.getItem("lucien.page.precedente") ?? page; } catch { /* */ }
  return { appareil: `${appareil}, ${nav}, ${installee}`, ecran: `${window.innerWidth}×${window.innerHeight}`, langue: langueChoisie(), page };
}

function EcrireEquipe({ api, formule, email, onClose, toast }: { api: Api; formule: string | null; email: string | null; onClose: () => void; toast: (m: string) => void }) {
  const [sujet, setSujet] = useState<SujetSupport>("question");
  const [message, setMessage] = useState("");
  const [infos, setInfos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fait, setFait] = useState(false);
  const t = infosTechniques();
  const envoyer = async () => {
    if (message.trim().length < 5) return toast("Écrivez quelques mots, s'il vous plaît");
    setBusy(true);
    try { await api.support({ sujet, message: message.trim(), infos, ...(infos ? t : {}) }); setFait(true); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="feuille-fond" onClick={onClose}>
      <div className="feuille" role="dialog" aria-modal="true" aria-label="Écrire à l'équipe Lucien" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="feuille-tete"><b>Écrire à l'équipe Lucien</b><button className="link" onClick={onClose}>{fait ? "Fermer" : "Annuler"}</button></div>
        {fait ? (
          <div className="aide-fait">
            <p><b>Message bien reçu, merci.</b></p>
            <p>{api.mode === "demo" ? "Démonstration : le message n'est pas envoyé. Dans l'appli, il arrive directement à l'équipe." : `Nous vous répondons par email${email ? ` à ${email}` : ""}, sous 48 h ouvrées.`}</p>
            <button className="btn block" onClick={onClose}>Fermer</button>
          </div>
        ) : (
          <div className="form-espace">
            <label className="champ"><span>C'est à propos de</span>
              <select className="in" value={sujet} onChange={(e) => setSujet(e.target.value as SujetSupport)}>{SUJETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {sujet === "banque" && <p className="note">Astuce : la plupart des soucis de connexion se règlent en reconnectant la banque (Budget, puis votre banque). Dites-nous quelle banque et ce qui s'affiche.</p>}
            {sujet === "abonnement" && <p className="note">Vous pouvez résilier vous-même dans « Votre formule », plus haut. Pour une facture, « Gérer mon abonnement ».</p>}
            <label className="champ"><span>Votre message</span>
              <textarea className="in" rows={6} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={sujet === "probleme" ? "Ce que vous faisiez, ce qui s'est passé, ce que vous attendiez" : "Écrivez-nous ici"} /></label>
            <label className="case"><input type="checkbox" checked={infos} onChange={(e) => setInfos(e.target.checked)} /> Joindre les infos techniques pour aller plus vite</label>
            {infos && <p className="note aide-infos" data-pas-traduire>{t.appareil} · écran {t.ecran} · dernier écran : {t.page} · formule {formule ?? "aucune"}</p>}
            <p className="note">Vos papiers et vos opérations ne sont jamais joints. Nous répondons à votre adresse email{email ? ` (${email})` : ""}.</p>
            <button className="btn block" disabled={busy} onClick={envoyer}>{busy ? "Envoi…" : "Envoyer"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
