import { useEffect, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { Household } from "../types";
import { Back } from "../ui";

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
        <div className="settings-row" key={i.token}><div><div className="t">{i.prenom ?? i.email}</div><div className="s">{i.email} · invitation en attente</div></div><button className="link" onClick={async () => { await api.annulerInvitation(i.token); load(); }}>Annuler</button></div>
      ))}
      <div className="lock" style={{ marginTop: 12 }}>
        <b>Inviter quelqu'un</b>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <input className="in" placeholder="Prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
          <input className="in" type="email" inputMode="email" placeholder="email@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={invite}>{busy ? <span className="spinner" /> : "Envoyer l'invitation"}</button>
        </div>
        {lien && <p className="note" style={{ marginTop: 8 }}>Mode développement, lien à transmettre : <a className="link" href={lien}>{lien}</a></p>}
        <p className="note" style={{ marginTop: 8 }}>{household.plan === "gratuit" ? "Le plan gratuit est réservé à une personne. Duo : 2 personnes, Tribu : jusqu'à 6." : (household.capacite_comptes ?? 6) < 6 ? `Votre formule accepte ${household.capacite_comptes} personne${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} connectée${(household.capacite_comptes ?? 1) > 1 ? "s" : ""} ; Tribu va jusqu'à 6.` : "Jusqu'à 6 personnes connectées."}</p>
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
  const [periode, setPeriode] = useState<"mensuel" | "annuel">("annuel");
  const comptes = household.comptes ?? 1;
  const formuleActuelle = household.plan_souscrit === "famille" || household.abonnement?.statut === "simule" ? household.abonnement?.formule ?? null : null;
  const conseil: Formule = comptes >= 3 ? "tribu" : "duo";
  const checkout = async (formule: Formule, p: "mensuel" | "annuel") => {
    try {
      const r = await api.checkout(formule, p);
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
        {household.essai?.actif && <p className="note" style={{ marginBottom: 10 }}>Vous profitez de tout Lucien, jusqu'à 6 personnes, pendant 15 jours, sans carte bancaire. Ensuite, le foyer passe en Gratuit (1 personne) en gardant tous vos papiers et vos échéances.</p>}

        <div className={`plan-card ${household.plan === "gratuit" ? "on" : ""}`}>
          <h3>Gratuit · 1 personne</h3>
          <ul><li>50 documents, fiches famille illimitées</li><li>Papiers lus localement (sans IA), champs à compléter</li><li>Rappels d'échéances (notifications sur le téléphone)</li><li>3 courriers par mois (modèles)</li><li>Sans import de relevés ni connexion bancaire</li></ul>
          {household.plan !== "gratuit" && api.mode === "demo" && <button className="link" style={{ marginTop: 10 }} onClick={() => { api.setPlan("gratuit"); onPlan("gratuit"); toast("Plan gratuit activé"); }}>Revenir au gratuit (démo)</button>}
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="section-head" style={{ marginBottom: 4 }}><h3 style={{ fontSize: 16 }}>Tout Lucien, selon le nombre de personnes connectées</h3></div>
          <p className="note" style={{ marginBottom: 10 }}>Chaque formule comprend tout : lecture IA, banque et économies, courriers illimités, rappels par email, adresse de transfert, connecteur IA. Les fiches sans connexion (enfants, parents âgés) sont illimitées.</p>
          <div className="pills" role="group" aria-label="Période">
            <button className="pill" aria-pressed={periode === "annuel"} onClick={() => setPeriode("annuel")}>Annuel · 2 mois offerts</button>
            <button className="pill" aria-pressed={periode === "mensuel"} onClick={() => setPeriode("mensuel")}>Mensuel</button>
          </div>
          {household.abonnement?.paiement === false && <p className="note" style={{ background: "var(--yolk-soft)", padding: "10px 12px", borderRadius: 12 }}>Le paiement en ligne arrive bientôt. D'ici là, votre essai et vos papiers restent tels quels.</p>}
          <button className="offre-lien" onClick={() => go("offre")}><b>Modules et packs</b><span>Budget expert, Vie pro, Patrimoine locatif : composez votre Lucien.</span></button>
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
              {household.abonnement.gerable && <button className="link" style={{ marginTop: 6 }} onClick={async () => { const r = await api.portail(); location.href = r.url; }}>Gérer mon abonnement (carte, factures, résiliation)</button>}
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
        <div className="section-head"><h2>Papiers par email</h2>{household.boite_email ? <span className="badge">active</span> : <span className="badge yolk">formule complète</span>}</div>
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
        ) : <p className="note">Pendant l'essai et avec la formule complète, vous recevez une adresse personnelle du type foyer-xxxxxx@in.monlucien.fr.</p>}
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
        <div className="settings-row"><div><div className="t">Santé et banque exclues</div><div className="s">Ces dossiers ne sont jamais lus par le connecteur</div></div><button className="toggle" role="switch" aria-checked="true" onClick={() => toast("Réglé côté serveur (LUCIEN_MCP_EXCLUDE)")} /></div>
        <div className="settings-row"><div><div className="t">Lecture seule</div><div className="s">Aucune action sans confirmation dans Lucien</div></div><button className="toggle" role="switch" aria-checked="true" onClick={() => toast("L'écriture arrivera plus tard, toujours avec confirmation")} /></div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Vos données</h2></div>
        <div className="settings-row"><div><div className="t">Hébergement</div><div className="s">Europe · chiffré · jamais revendu</div></div></div>
        <div className="settings-row"><div><div className="t">Exporter tout</div><div className="s">Documents et échéances au format JSON</div></div><button className="link" onClick={() => toast("Export disponible dans la version serveur")}>Exporter</button></div>
        <div className="settings-row"><div><div className="t">Supprimer le compte</div><div className="s">Tout est effacé, sans délai</div></div><button className="link" style={{ color: "var(--ember)" }} onClick={() => toast("Dans le prototype, supprimez le fichier de données")}>Supprimer</button></div>
        {household.utilisateur && <div className="settings-row"><div><div className="t">Connecté·e</div><div className="s">{household.utilisateur.email}</div></div><button className="link" onClick={async () => { await api.deconnexion(); location.reload(); }}>Se déconnecter</button></div>}
      </section>
    </div>
  );
}
