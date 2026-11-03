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
    <section className="section">
      <div className="section-head"><h2>Le point du dimanche</h2>{on ? <span className="badge">actif</span> : <span className="badge yolk">arrêté</span>}</div>
      <div className="settings-row">
        <div><div className="t">La semaine de Lucien</div><div className="s">Chaque dimanche soir : échéances, agenda des enfants, économies et un conseil{household.plan === "famille" ? ", par notification et par email" : ", par notification"}.</div></div>
        <button className="toggle" role="switch" aria-checked={on} aria-label="Le point du dimanche" onClick={basculer} />
      </div>
      <button className="link" style={{ marginTop: 10 }} onClick={() => go("semaine")}>Voir ma semaine</button>
    </section>
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
  return (
    <section className="section">
      <div className="section-head"><h2>Famille partagée</h2>{data && <span className="badge">{data.comptes.length} / {household.capacite_comptes ?? "?"} personne{(household.capacite_comptes ?? 2) > 1 ? "s" : ""}</span>}</div>
      <p style={{ marginBottom: 10 }}>Votre conjoint·e ou un proche reçoit un lien par email et ouvre le même foyer sur son téléphone : mêmes papiers, mêmes rappels, même budget.</p>
      {data?.comptes.map((c) => (
        <div className="settings-row" key={c.id}><div><div className="t">{c.prenom ?? c.email}{household.utilisateur?.id === c.id ? " (vous)" : ""}</div><div className="s">{c.email} · {c.role === "proprietaire" ? "propriétaire du foyer" : "membre"}</div></div>{owner && household.utilisateur?.id !== c.id && c.role !== "proprietaire" && <button className="link" style={{ color: "var(--ember)" }} onClick={async () => { if (confirm(`Retirer ${c.prenom ?? c.email} du foyer ?`)) { await api.retirerCompte(c.id); toast("Compte retiré"); load(); } }}>Retirer</button>}</div>
      ))}
      {data?.invitations.map((i) => (
        <div className="settings-row" key={i.id}><div><div className="t">{i.prenom ?? i.email}</div><div className="s">{i.email} · invitation en attente</div></div><button className="link" onClick={async () => { await api.annulerInvitation(i.id); load(); }}>Annuler</button></div>
      ))}
      <div className="lock" style={{ marginTop: 12 }}>
        <b>Inviter quelqu'un</b>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <input className="in" placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          <input className="in" type="email" inputMode="email" placeholder="email@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={invite}>{busy ? <span className="spinner" /> : "Envoyer l'invitation"}</button>
        </div>
        {lien && <p className="note" style={{ marginTop: 8 }}>Mode développement, lien à transmettre : <a className="link" href={lien}>{lien}</a></p>}
        <p className="note" style={{ marginTop: 8 }}>{household.plan === "gratuit" ? "Sans abonnement, un seul compte reste connecté. Duo : 2 personnes, Tribu : jusqu’à 6." : (household.capacite_comptes ?? 6) < 6 ? `Votre formule accepte ${household.capacite_comptes} personne${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} connectée${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} ; Tribu va jusqu'à 6.` : "Jusqu'à 6 personnes connectées."}</p>
      </div>
    </section>
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
  const [periode, setPeriode] = useState<"mensuel" | "annuel">("annuel");
  const comptes = household.comptes ?? 1;
  const formuleActuelle = household.plan_souscrit === "famille" || household.abonnement?.statut === "simule" ? household.abonnement?.formule ?? null : null;
  const conseil: Formule = comptes >= 3 ? "tribu" : "duo";
  const [demarrage, setDemarrage] = useState(false);
  const checkout = async (formule: Formule, p: "mensuel" | "annuel") => {
    if (!formuleActuelle && !demarrage) { toast("Cochez d'abord la case sur le démarrage de l'abonnement."); return; }
    try {
      const r = await api.checkout(formule, p, true);
      if (r.url) { location.href = r.url; return; }
      onPlan("famille"); toast(`Formule ${TIERS.find((t) => t.id === formule)!.nom} activée (démo)`);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="screen">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Réglages</h1><p className="sub"><button className="link" style={{ fontWeight: 500, color: "var(--mist)" }} onClick={async () => { const n = prompt("Nom du foyer", household.nom); if (n && n.trim()) { await api.renommer(n.trim()); onPlan(household.plan); } }}>{household.nom} ✎</button>{api.mode === "demo" ? " · mode démo" : ""}</p></div></div>

      <section className="section">
        <div className="section-head"><h2>Votre formule</h2>{household.essai?.actif && <span className="badge">essai : {household.essai.jours_restants} j</span>}</div>
        {household.essai?.actif && <p className="note" style={{ marginBottom: 10 }}>Vous profitez de tout Lucien, jusqu'à 6 personnes, pendant 15 jours, sans carte bancaire. Ensuite, choisissez une formule : sans abonnement, vos papiers et vos échéances restent consultables et exportables, mais Lucien ne range plus rien de nouveau.</p>}

        <div className={`plan-card ${household.plan === "gratuit" ? "on" : ""}`}>
          <h3>Sans abonnement, après l'essai</h3>
          <ul><li>Vos papiers et vos échéances restent consultables et exportables</li><li>Les rappels d'échéances continuent (notifications sur le téléphone)</li><li>Pas de nouveau papier, ni lecture par l'IA, ni banque, ni modules</li><li>Un seul compte reste connecté</li></ul>
          {household.plan !== "gratuit" && api.mode === "demo" && <button className="link" style={{ marginTop: 10 }} onClick={() => { api.setPlan("gratuit"); onPlan("gratuit"); toast("Fin d'essai simulée"); }}>Simuler la fin de l'essai (démo)</button>}
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="section-head" style={{ marginBottom: 4 }}><h3 style={{ fontSize: 16 }}>Tout Lucien, selon le nombre de personnes connectées</h3></div>
          <p className="note" style={{ marginBottom: 10 }}>Chaque formule comprend tout : lecture IA, banque et économies, courriers illimités, rappels par email, adresse de transfert, connecteur IA. Les fiches sans connexion (enfants, parents âgés) sont illimitées.</p>
          <div className="pills" role="group" aria-label="Période">
            <button className="pill" aria-pressed={periode === "annuel"} onClick={() => setPeriode("annuel")}>Annuel · 2 mois offerts</button>
            <button className="pill" aria-pressed={periode === "mensuel"} onClick={() => setPeriode("mensuel")}>Mensuel</button>
          </div>
          {household.abonnement?.paiement === false && <p className="note" style={{ background: "var(--yolk-soft)", padding: "10px 12px", borderRadius: 12 }}>Le paiement en ligne arrive bientôt. D'ici là, votre essai et vos papiers restent tels quels.</p>}
          <CodePartenaire api={api} toast={toast} />
          <button className="offre-lien" onClick={() => go("offre")}><b>Modules et packs</b><span>Budget expert, Vie pro, Patrimoine locatif : composez votre Lucien.</span></button>
          {!formuleActuelle && <ConsentementDemarrage coche={demarrage} onChange={setDemarrage} />}
          <div className="tiers">
            {TIERS.map((t) => {
              const actuel = formuleActuelle === t.id;
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
                    : <button className={`btn block ${t.id === conseil ? "" : "ghost"}`} style={{ marginTop: 10 }} onClick={() => checkout(t.id, periode)}>{formuleActuelle ? `Passer à ${t.nom}` : `Choisir ${t.nom}`}</button>}
                </div>
              );
            })}
          </div>
          <p className="note" style={{ marginTop: 10 }}>Paiement sécurisé par Stripe. Sans engagement : on change de formule ou on résilie en un clic.</p>
          {(household.abonnement?.statut === "active" || household.abonnement?.statut === "simule" || household.abonnement?.statut === "past_due") && (
            <div style={{ marginTop: 12 }}>
              <p className="note">Formule {TIERS.find((t) => t.id === formuleActuelle)?.nom ?? ""}, paiement {household.abonnement.periode === "annuel" ? "annuel" : "mensuel"}{household.abonnement.fin ? `, prochaine échéance le ${new Date(household.abonnement.fin).toLocaleDateString("fr-FR")}` : ""}{household.abonnement.statut === "past_due" ? " · paiement en attente, mettez à jour votre carte" : ""}{household.abonnement.statut === "simule" ? " · simulé (Stripe non configuré)" : ""}.</p>
              {household.abonnement.gerable && <button className="link" style={{ marginTop: 6 }} onClick={async () => { const r = await api.portail(); location.href = r.url; }}>Gérer mon abonnement (carte, factures)</button>}
              <Resiliation api={api} household={household} toast={toast} />
              <Retractation api={api} household={household} toast={toast} />
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Membres du foyer</h2></div>
        {household.membres.map((m) => (
          <div className="settings-row" key={m.id}><div><div className="t">{m.prenom}</div><div className="s">{ROLE_LABEL[m.role] ?? m.role}</div></div></div>
        ))}
        <button className="link" style={{ marginTop: 10 }} onClick={() => go("famille")}>Composition du foyer, écoles, activités, conseils</button>
      </section>

      <FamillePartagee api={api} household={household} toast={toast} />

      <PointDimanche api={api} household={household} onChanged={() => onPlan(household.plan)} toast={toast} go={go} />

      <section className="section">
        <div className="section-head"><h2>Papiers par email</h2>{household.boite_email ? <span className="badge">active</span> : household.boite_bientot ? <span className="badge yolk">bientôt</span> : <span className="badge yolk">formule complète</span>}</div>
        <p style={{ marginBottom: 10 }}>Transférez un email à votre adresse Lucien : la facture, le contrat ou l'avis d'échéance se range tout seul et crée ses rappels. Lucien ne lit jamais votre boîte mail, seulement ce que vous lui envoyez.</p>
        {household.boite_email ? (
          <>
            <div className="settings-row"><div><div className="t">Votre adresse Lucien</div><div className="s">À enregistrer dans vos contacts</div></div><button className="link" onClick={async () => { try { await navigator.clipboard.writeText(household.boite_email!); toast("Adresse copiée"); } catch { toast(household.boite_email!); } }}>Copier</button></div>
            <div className="code" style={{ marginTop: 8 }}>{household.boite_email}</div>
            <p className="note" style={{ marginTop: 10 }}>Astuce : dans Gmail ou Outlook, créez une règle « tout ce qui vient de EDF, MAIF, Orange… → transférer à cette adresse ». Vos papiers arriveront sans rien faire.</p>
            {(household.boite_recus?.length ?? 0) > 0 && (
              <ul className="list" style={{ marginTop: 10 }}>
                {household.boite_recus!.slice(0, 5).map((m) => <li key={m.message_id} className="settings-row"><div><div className="t">{m.objet ?? "(sans objet)"}</div><div className="s">{m.expediteur ?? ""} · {m.documents} papier{m.documents > 1 ? "s" : ""}</div></div></li>)}
              </ul>
            )}
          </>
        ) : household.boite_bientot ? <p className="note">Votre adresse personnelle arrive bientôt : elle sera activée avec l'adresse email de Lucien. En attendant, ajoutez vos papiers avec le bouton +.</p>
          : <p className="note">Pendant l'essai et avec la formule complète, vous recevez une adresse personnelle du type foyer-xxxxxx@in.monlucien.fr.</p>}
      </section>

      <section className="section">
        <div className="section-head"><h2>Assistant Lucien</h2>{household.assistant?.option ? <span className="badge">actif</span> : <span className="badge yolk">option</span>}</div>
        <p style={{ marginBottom: 10 }}>Posez vos questions directement dans Lucien : « qu'est-ce que je dois faire ce mois-ci ? », « résilie mon assurance auto ». Sans compte Claude ni ChatGPT.</p>
        <div className="settings-row">
          <div><div className="t">{household.assistant?.option ? "Option active" : `${fmtPrix(household.assistant?.prix.mensuel ?? 2.9)} par mois ou ${fmtPrix(household.assistant?.prix.annuel ?? 29)} par an`}</div><div className="s">{household.assistant?.option ? `${household.assistant.restantes} questions restantes ce mois-ci, sur ${household.assistant.quota}` : household.assistant?.acces === "essai" ? `Essai : ${household.assistant.restantes} questions offertes` : "Jusqu'à 300 questions par mois, en plus de votre formule"}</div></div>
          {household.assistant?.option
            ? <button className="link" onClick={async () => { if (!confirm("Retirer l'option assistant ?")) return; try { await api.assistantOption(false); onPlan(household.plan); toast("Option retirée"); } catch (e) { toast((e as Error).message); } }}>Retirer</button>
            : household.plan === "famille"
              ? <button className="link" onClick={async () => { try { await api.assistantOption(true); onPlan(household.plan); toast("Assistant activé"); } catch (e) { toast((e as Error).message); } }}>Ajouter</button>
              : <span className="badge yolk">avec une formule</span>}
        </div>
        <button className="link" style={{ marginTop: 10 }} onClick={() => go("assistant")}>Ouvrir l'assistant</button>
      </section>

      <section className="section">
        <div className="section-head"><h2>Connecteur IA</h2>{household.plan === "famille" ? <span className="badge">actif</span> : <span className="badge yolk">formule complète</span>}</div>
        <p style={{ marginBottom: 10 }}>Demandez à Claude ou ChatGPT « quand expire mon assurance auto ? » : l'assistant interroge vos papiers, en lecture seule, et chaque accès est journalisé.</p>
        <button className="btn ghost block" style={{ marginBottom: 10 }} onClick={() => go("connecteur")}>Brancher Lucien sur Claude ou ChatGPT : le tuto</button>
        {household.mcp_token ? (
          <>
            <div className="settings-row"><div><div className="t">Adresse personnelle du connecteur</div><div className="s">À coller dans Claude ou ChatGPT (voir le tuto). Gardez-la pour vous : elle ouvre vos papiers.</div></div><button className="link" onClick={async () => { const u = `${mcpUrl}/${household.mcp_token}`; try { await navigator.clipboard.writeText(u); toast("Adresse copiée"); } catch { toast(u); } }}>Copier</button></div>
            <div className="code" style={{ marginTop: 8, wordBreak: "break-all" }}>{mcpUrl}/{household.mcp_token}</div>
            <p className="note" style={{ marginTop: 8 }}>Pour un outil qui accepte un en-tête d'autorisation (Claude Desktop, Cursor) : adresse {mcpUrl} et « Bearer » suivi du jeton.</p>
            <button className="link" style={{ marginTop: 8 }} onClick={async () => { const t = await api.regenererMcp(); toast("Nouveau jeton : " + t.slice(0, 6) + "…"); onPlan(household.plan); }}>Régénérer l'adresse (révoque l'ancienne)</button>
          </>
        ) : <p className="note">L'adresse personnelle du connecteur apparaît ici avec la formule complète.</p>}
        <div className="settings-row"><div><div className="t">Banque exclue</div><div className="s">Vos opérations bancaires ne sont jamais lues par le connecteur</div></div><button className="toggle" role="switch" aria-checked="true" onClick={() => toast("Réglé côté serveur (LUCIEN_MCP_EXCLUDE)")} /></div>
        <div className="settings-row"><div><div className="t">Lecture seule</div><div className="s">Aucune action sans confirmation dans Lucien</div></div><button className="toggle" role="switch" aria-checked="true" onClick={() => toast("L'écriture arrivera plus tard, toujours avec confirmation")} /></div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Aide</h2></div>
        {household.assistant && household.assistant.acces !== "aucun" && <div className="settings-row"><div><div className="t">Demander à Lucien</div><div className="s">Réponse immédiate pour se servir de l'appli</div></div><button className="link" onClick={() => go("assistant")}>Demander</button></div>}
        <div className="settings-row"><div><div className="t">Écrire à l'équipe Lucien</div><div className="s">Une question, un souci, une idée : réponse par email sous 48 h ouvrées</div></div><button className="link" onClick={() => setAide(true)}>Écrire</button></div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Vos données</h2></div>
        <div className="settings-row"><div><div className="t">Langue de l'appli</div><div className="s">Language of the app</div></div>
          <select className="in langue-choix" aria-label="Langue / Language" value={langueChoisie()} onChange={(e) => choisirLangue(e.target.value as "fr" | "en")} data-pas-traduire>
            <option value="fr">Français</option><option value="en">English</option>
          </select></div>
        <div className="settings-row"><div><div className="t">Hébergement</div><div className="s">Europe · connexion chiffrée · jamais revendu</div></div></div>
        <div className="settings-row"><div><div className="t">Exporter tout</div><div className="s">Vos papiers d'origine et toutes vos données, dans un fichier .zip</div></div><button className="link" onClick={async () => { toast("Préparation de l'export…"); try { await api.exporter(); } catch (e) { toast((e as Error).message); } }}>Exporter</button></div>
        {household.abonnement?.suppression_le && household.titulaire !== false ? (
          <div className="settings-row suppr-prevue"><div><div className="t">Suppression prévue le {dateFr(household.abonnement.suppression_le)}</div><div className="s">Tout reste accessible d'ici là. Pensez à exporter vos données.</div></div><button className="link" onClick={async () => { try { await api.annulerSuppression(); toast("Suppression annulée, l'abonnement continue"); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Annuler</button></div>
        ) : <div className="settings-row"><div><div className="t">Supprimer le compte</div><div className="s">{household.titulaire === false ? "Vous quittez le foyer, votre compte est effacé" : "Le foyer est effacé à la fin de la période déjà payée"}</div></div><button className="link" style={{ color: "var(--ember)" }} onClick={() => setSuppression(true)}>Supprimer</button></div>}
        {household.utilisateur && <div className="settings-row"><div><div className="t">Connecté·e</div><div className="s">{household.utilisateur.email}</div></div><button className="link" onClick={async () => { await api.deconnexion(); location.reload(); }}>Se déconnecter</button></div>}
      </section>
      {aide && <EcrireEquipe api={api} formule={household.abonnement?.formule ?? null} email={household.utilisateur?.email ?? null} onClose={() => setAide(false)} toast={toast} />}
      {suppression && <SuppressionCompte api={api} titulaire={household.titulaire !== false} foyer={household.nom} paye={paiementEnCours(household)} fin={household.abonnement?.fin ?? null} onClose={() => setSuppression(false)} toast={toast} />}
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
      <div style={{ display: "flex", gap: 14 }}><button className="link" style={{ color: "var(--ember)" }} onClick={async () => { try { const x = await api.seRetracter(); toast(x.rembourse_centimes ? `Rétractation faite : ${(x.rembourse_centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € remboursés sous quelques jours` : "Rétractation faite"); setTimeout(() => location.reload(), 1500); } catch (e) { toast((e as Error).message); } }}>Confirmer la rétractation</button><button className="link" onClick={() => setConfirmer(false)}>Garder</button></div></div>
  ) : <button className="link" style={{ marginTop: 6, display: "block" }} onClick={() => setConfirmer(true)}>Me rétracter (jusqu'au {r.jusquau ? dateFr(r.jusquau) : "14e jour"})</button>;
}

/** « Résilier l'abonnement » : no renewal, active until the end of the period already paid; can be taken back. */
function Resiliation({ api, household, toast }: { api: Api; household: Household; toast: (m: string) => void }) {
  const a = household.abonnement;
  const [confirmer, setConfirmer] = useState(false);
  if (!a || !paiementEnCours(household) || household.titulaire === false || a.suppression_le) return null;
  if (a.abonnement_resilie) return (
    <div className="resil-note"><span>Abonnement résilié : il reste actif jusqu'au {a.fin ? dateFr(a.fin) : "terme de la période"}, puis s'arrête sans autre prélèvement.</span>
      <button className="link" onClick={async () => { try { await api.reprendre(); toast("Abonnement repris"); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Reprendre l'abonnement</button></div>
  );
  return confirmer ? (
    <div className="resil-note"><span>L'abonnement ne sera pas renouvelé. Il reste actif jusqu'au {a.fin ? dateFr(a.fin) : "terme de la période déjà payée"}, sans remboursement ; vos papiers restent ensuite consultables.</span>
      <div style={{ display: "flex", gap: 14 }}><button className="link" style={{ color: "var(--ember)" }} onClick={async () => { try { const r = await api.resilier(); toast(`Résilié : actif jusqu'au ${dateFr(r.fin)}`); setTimeout(() => location.reload(), 900); } catch (e) { toast((e as Error).message); } }}>Confirmer la résiliation</button><button className="link" onClick={() => setConfirmer(false)}>Garder</button></div></div>
  ) : <button className="link" style={{ marginTop: 6, display: "block" }} onClick={() => setConfirmer(true)}>Résilier l'abonnement</button>;
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
