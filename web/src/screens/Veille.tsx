import { useEffect, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { Banque, Doc, Member, Mesure, Temoin, Veille, VeillesReport, VuePersonne } from "../types";
import { Back, Logo, fmtDate } from "../ui";
import { BankPicker } from "../BankPicker";

/**
 * Bank watch of a protected relative: read-only anti-scam alerts, with the person's (or her legal
 * representative's) consent, witnesses who receive the same alerts, and a tamper-evident log.
 * The framework is the point: it protects the person first, and the family against later disputes.
 */

const MESURES: { v: Mesure; t: string; d: string }[] = [
  { v: "aucune", t: "Aucune mesure", d: "Elle décide seule et donne son accord elle-même." },
  { v: "curatelle", t: "Curatelle", d: "Elle donne son accord, avec son curateur." },
  { v: "tutelle", t: "Tutelle", d: "Le tuteur désigné par le juge autorise." },
  { v: "habilitation_familiale", t: "Habilitation familiale", d: "La personne habilitée par le juge autorise." },
  { v: "mandat_protection_future", t: "Mandat de protection future", d: "Le mandataire, une fois le mandat activé, autorise." },
];
const STATUT: Record<Veille["statut"], { t: string; cls: string }> = {
  attente_consentement: { t: "En attente d'accord", cls: "badge yolk" },
  active: { t: "Active", cls: "badge" },
  suspendue: { t: "Accord à renouveler", cls: "badge yolk" },
  terminee: { t: "Terminée", cls: "badge yolk" },
};
const ACTION: Record<string, string> = { demande: "Demande de veille", consentement: "Accord donné", connexion_banque: "Banque connectée", consultation: "Consultation", fin: "Fin de la veille", suspension: "Suspension", effacement: "Effacement des opérations" };
const MOTIF: Record<string, string> = { retrait_consentement: "accord retiré", deces: "décès", fin_mesure: "fin de la mesure", demande_aidant: "à la demande de l'aidant" };

export const estProtegeable = (m: Pick<Member, "role">) => m.role === "parent_a_charge" || m.role === "autre_a_charge";

/** Card on the person's page: start a watch, or its status. */
export function VeilleCard({ api, membre, go }: { api: Api; membre: Member; go: (s: string, id?: string) => void }) {
  const [r, setR] = useState<VeillesReport | null>(null);
  useEffect(() => { api.veilles().then(setR).catch(() => setR(null)); }, [membre.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  const v = r.veilles.find((x) => x.member_id === membre.id && x.statut !== "terminee");
  return (
    <section className="section">
      <div className="section-head"><h2>Veille anti-arnaque</h2>{v && <span className={STATUT[v.statut].cls}>{STATUT[v.statut].t}</span>}</div>
      {v ? (
        <button className="row-item" style={{ gridTemplateColumns: "1fr auto", width: "100%" }} onClick={() => go("veille", v.id)}>
          <div>
            <div className="t">{v.statut === "active" ? (v.alertes_non_vues ? `${v.alertes_non_vues} alerte${v.alertes_non_vues > 1 ? "s" : ""} à regarder` : "Rien d'inhabituel") : v.statut === "attente_consentement" ? `En attente de l'accord ${v.mesure === "aucune" ? `de ${membre.prenom}` : "du représentant"}` : "L'accord est à renouveler"}</div>
            <div className="s">{v.banque_connectee ? "Compte suivi en lecture seule" : "Banque pas encore connectée"}{v.temoins.length ? ` · ${v.temoins.length} témoin${v.temoins.length > 1 ? "s" : ""}` : ""}</div>
          </div>
          {v.alertes_urgentes > 0 ? <span className="badge" style={{ background: "var(--ember)", color: "#fff" }}>{v.alertes_urgentes} urgente{v.alertes_urgentes > 1 ? "s" : ""}</span> : <span />}
        </button>
      ) : (
        <>
          <p className="note">Arnaques au faux conseiller, coupons prépayés, virements vers un inconnu, démarchage : Nidou regarde le compte de {membre.prenom} en lecture seule et vous prévient, avec son accord ou celui de son représentant légal.</p>
          {!r.ouverte && <div className="confidence" style={{ display: "block" }}>Cette fonction ouvrira après validation par notre avocat. Le cadre est prêt : accord écrit, témoins, journal infalsifiable, retrait à tout moment.</div>}
          {r.ouverte && <button className="btn" onClick={() => go("veille-nouvelle", membre.id)}>Mettre en place la veille</button>}
        </>
      )}
    </section>
  );
}

/** Setup: the legal situation, the act, the witnesses. Refuses what the law doesn't allow. */
export function VeilleNouvelle({ api, memberId, onBack, go, toast }: { api: Api; memberId: string; onBack: () => void; go: (s: string, id?: string) => void; toast: (m: string) => void }) {
  const [m, setM] = useState<Member | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [mesure, setMesure] = useState<Mesure | null>(null);
  const [peut, setPeut] = useState<boolean | null>(null);
  const [acte, setActe] = useState<string>("");
  const [qualite, setQualite] = useState("");
  const [temoins, setTemoins] = useState<Temoin[]>([{ nom: "", email: null }]);
  const [loyaute, setLoyaute] = useState(false);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.famille().then((f) => setM(f.membres.find((x) => x.id === memberId) ?? null));
    api.documents().then(setDocs);
  }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;

  const submit = async () => {
    if (!mesure) return;
    setBusy(true); setErr(null);
    try {
      const v = await api.creerVeille({ member_id: m.id, mesure, acte_document_id: acte || null, aidant_qualite: qualite.trim() || null, temoins: temoins.filter((t) => t.nom.trim()), personne_peut_consentir: mesure === "aucune" ? peut === true : mesure === "curatelle" });
      toast("Veille créée : il reste l'accord");
      go("veille", v.id);
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: "erreur", message: (e as Error).message });
    } finally { setBusy(false); }
  };
  const acheter = async (periode: "mensuel" | "annuel") => { await api.acheterVeille(periode); toast("Veille supplémentaire ajoutée"); setErr(null); };

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <h1 className="detail-title">Veiller sur le compte de {m.prenom}</h1>
      <p className="detail-sub">Lecture seule, alertes anti-arnaque, avec son accord.</p>

      <section className="section">
        <div className="section-head"><h2>1. Sa situation juridique</h2></div>
        <div className="mesures">
          {MESURES.map((x) => (
            <button key={x.v} className="row-item" aria-pressed={mesure === x.v} style={{ gridTemplateColumns: "1fr", width: "100%", outline: mesure === x.v ? "2px solid var(--moss)" : undefined }} onClick={() => { setMesure(x.v); setErr(null); }}>
              <div><div className="t">{x.t}</div><div className="s">{x.d}</div></div>
            </button>
          ))}
        </div>
      </section>

      {mesure === "aucune" && (
        <section className="section">
          <div className="section-head"><h2>2. Peut-elle donner son accord ?</h2></div>
          <p className="note">Comprend-elle ce qu'on lui propose et peut-elle dire oui ou non, librement ? Si vous hésitez, demandez à son médecin traitant.</p>
          <div className="pills">
            <button className="pill" aria-pressed={peut === true} onClick={() => setPeut(true)}>Oui</button>
            <button className="pill" aria-pressed={peut === false} onClick={() => setPeut(false)}>Non, plus vraiment</button>
          </div>
          {peut === false && (
            <div className="confidence" style={{ display: "block", marginTop: 12 }}>
              Sans son accord, ni vous ni Nidou ne pouvez regarder son compte. Il faut une mesure de protection, demandée au juge des contentieux de la protection du tribunal judiciaire : l'habilitation familiale est la plus simple quand la famille est d'accord. Le formulaire et le certificat médical circonstancié sont expliqués sur <a href="https://www.service-public.fr/particuliers/vosdroits/F33367" target="_blank" rel="noreferrer">service-public.fr</a>.
            </div>
          )}
        </section>
      )}

      {mesure && mesure !== "aucune" && (
        <section className="section">
          <div className="section-head"><h2>2. Le jugement ou le mandat</h2></div>
          <p className="note">Ajoutez-le d'abord dans Papiers (une photo suffit), puis choisissez-le ici. Il reste joint à la veille et figure au journal.</p>
          <div className="fields">
            <div className="field"><span>Acte</span>
              <select value={acte} onChange={(e) => setActe(e.target.value)}>
                <option value="">Choisir un document…</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
            <div className="field"><span>Votre qualité</span><input value={qualite} placeholder={mesure === "tutelle" ? "Tuteur, tutrice" : mesure === "curatelle" ? "Curateur, curatrice" : mesure === "habilitation_familiale" ? "Personne habilitée" : "Mandataire"} onChange={(e) => setQualite(e.target.value)} /></div>
          </div>
          <button className="link" onClick={() => go("add")}>Ajouter le document maintenant</button>
        </section>
      )}

      {mesure && !(mesure === "aucune" && peut !== true) && (
        <>
          <section className="section">
            <div className="section-head"><h2>3. Les témoins</h2></div>
            <p className="note">Un frère, une sœur, un autre proche : ils reçoivent exactement les mêmes alertes que vous. Personne ne surveille seul, et personne ne pourra dire plus tard qu'il n'était pas au courant.</p>
            <div className="fields">
              {temoins.map((t, i) => (
                <div key={i} className="field" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <input value={t.nom} placeholder="Prénom et nom" onChange={(e) => setTemoins(temoins.map((x, j) => j === i ? { ...x, nom: e.target.value } : x))} />
                  <input type="email" value={t.email ?? ""} placeholder="Email" onChange={(e) => setTemoins(temoins.map((x, j) => j === i ? { ...x, email: e.target.value || null } : x))} />
                </div>
              ))}
            </div>
            {temoins.length < 6 && <button className="link" onClick={() => setTemoins([...temoins, { nom: "", email: null }])}>Ajouter un témoin</button>}
          </section>

          <section className="section">
            <div className="section-head"><h2>4. Votre engagement</h2></div>
            <label style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 10, alignItems: "start", fontSize: 14.5 }}>
              <input type="checkbox" checked={loyaute} onChange={(e) => setLoyaute(e.target.checked)} />
              <span>J'utilise cette veille uniquement pour protéger {m.prenom} des arnaques et des abus. Je ne m'en sers pas pour contrôler ses choix, ni dans un conflit familial ou d'héritage. Je sais qu'elle voit qui regarde, et qu'elle peut tout arrêter seule.</span>
            </label>
          </section>

          {err && (
            <div className="confidence" style={{ display: "block" }}>
              {err.message}
              {err.code === "veille_payante" && !/gratuite|payante\./.test(err.message) && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => acheter("mensuel")}>Ajouter : 3,90 € / mois</button>
                  <button className="btn ghost" onClick={() => acheter("annuel")}>39 € / an</button>
                </div>
              )}
              {err.code === "veille_payante" && /payante\./.test(err.message) && <div style={{ marginTop: 10 }}><button className="btn" onClick={() => go("settings")}>Voir les formules</button></div>}
            </div>
          )}
          <button className="btn" disabled={!loyaute || busy} onClick={submit}>{busy ? "Un instant…" : "Créer la veille et obtenir le lien d'accord"}</button>
        </>
      )}
    </div>
  );
}

/** The watch: alerts, consent link, people with access, the log, ending it. */
export function VeilleDetail({ api, id, onBack, toast }: { api: Api; id: string; onBack: () => void; toast: (m: string) => void }) {
  const [v, setV] = useState<Veille | null>(null);
  const [journal, setJournal] = useState<Awaited<ReturnType<Api["journalVeille"]>> | null>(null);
  const load = async () => setV(await api.veille(id));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;

  const partager = async () => {
    if (!v.lien_personne) return;
    const texte = `Voici ta page Nidou pour la veille de ton compte. Tu y vois qui reçoit les alertes, et tu peux tout arrêter quand tu veux.`;
    try { if (navigator.share) { await navigator.share({ title: "Nidou", text: texte, url: v.lien_personne }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(v.lien_personne); toast("Lien copié"); } catch { prompt("Lien à transmettre", v.lien_personne); }
  };
  const vu = async () => { await api.veilleVue(v.id); await load(); };
  const terminer = async (motif: "deces" | "fin_mesure" | "demande_aidant") => {
    if (!confirm(`Arrêter la veille du compte de ${v.prenom} ? Les opérations seront effacées après la durée de conservation ; le journal est gardé.`)) return;
    setV(await api.terminerVeille(v.id, motif)); toast("Veille arrêtée");
  };
  const exp = v.consentement_expire ? Math.ceil((new Date(v.consentement_expire).getTime() - Date.now()) / 864e5) : null;

  return (
    <div className="screen">
      <Back onClick={onBack} />
      <h1 className="detail-title">Veille · {v.prenom}</h1>
      <p className="detail-sub"><span className={STATUT[v.statut].cls}>{STATUT[v.statut].t}</span> · {v.mesure_label}{v.aidant_qualite ? ` · vous êtes ${v.aidant_qualite.toLowerCase()}` : ""}</p>

      {(v.statut === "attente_consentement" || v.statut === "suspendue") && (
        <section className="section">
          <div className="section-head"><h2>{v.statut === "suspendue" ? "Renouveler l'accord" : "L'accord"}</h2></div>
          <p className="note">{v.qui_consent?.texte} Transmettez ce lien personnel{v.mesure === "aucune" ? ` à ${v.prenom}` : ""} : la page explique tout en clair, l'accord s'y donne, et {v.prenom} y connecte elle-même sa banque. Personne ne lui demande son code.</p>
          <div className="fields"><div className="field"><span>Lien personnel</span><input readOnly value={v.lien_personne ?? ""} onFocus={(e) => e.target.select()} /></div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={partager}>Envoyer le lien</button>
            {api.mode === "demo" && v.lien_personne && <button className="btn ghost" onClick={() => { location.hash = `#/consentement/${v.lien_personne!.split("/consentement/")[1]}`; window.scrollTo({ top: 0 }); }}>Ouvrir sa page (démo)</button>}
            <button className="btn ghost" onClick={load}>Actualiser</button>
          </div>
        </section>
      )}

      {v.statut === "active" && (
        <section className="section">
          <div className="section-head"><h2>Alertes</h2>{(v.alertes ?? []).some((a) => !a.vue) && <button className="link" onClick={vu}>Tout marquer comme vu</button>}</div>
          {!v.banque_connectee ? <p className="note">{v.prenom} n'a pas encore connecté sa banque depuis sa page. Renvoyez-lui le lien si besoin.</p>
            : (v.alertes ?? []).length === 0 ? <p className="note">Rien d'inhabituel. Nidou vous prévient au moindre virement vers un inconnu, achat de coupon, retrait en série ou nouveau prélèvement.</p>
            : (v.alertes ?? []).map((a) => (
              <div key={a.id} className={`alert ${a.gravite === "urgente" ? "important" : "attention"}`} style={{ opacity: a.vue ? 0.6 : 1 }}>
                <i />
                <div><div className="t">{a.titre}</div><div className="d">{a.detail}</div></div>
                <div className="save" style={{ fontSize: 13 }}>{fmtDate(a.quand.slice(0, 10))}</div>
              </div>
            ))}
          {(v.alertes ?? []).some((a) => a.gravite === "urgente") && (
            <div className="confidence" style={{ display: "block" }}>Le bon réflexe : appeler {v.prenom} calmement, sans reproche, puis sa banque (opposition, rappel de virement). En cas d'escroquerie : plainte, et signalement sur <a href="https://www.cybermalveillance.gouv.fr" target="_blank" rel="noreferrer">cybermalveillance.gouv.fr</a> ou au 17.</div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <button className="btn ghost" onClick={partager}>Renvoyer sa page à {v.prenom}</button>
            {api.mode === "demo" && v.lien_personne && <button className="btn ghost" onClick={() => { location.hash = `#/consentement/${v.lien_personne!.split("/consentement/")[1]}`; window.scrollTo({ top: 0 }); }}>Ouvrir sa page (démo)</button>}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Qui voit quoi</h2></div>
        <ul className="list">
          <li><div className="row-item" style={{ gridTemplateColumns: "1fr" }}><div><div className="t">{v.aidant}</div><div className="s">{v.aidant_qualite ?? "Aidant"} · alertes et opérations</div></div></div></li>
          {v.temoins.map((t) => <li key={t.nom}><div className="row-item" style={{ gridTemplateColumns: "1fr" }}><div><div className="t">{t.nom}</div><div className="s">Témoin · reçoit les mêmes alertes{t.email ? ` (${t.email})` : ""}</div></div></div></li>)}
        </ul>
        <p className="note">{v.prenom} voit cette liste et les dernières consultations sur sa page. {exp !== null && v.statut === "active" ? `Accord valable encore ${exp} jours.` : ""}</p>
      </section>

      <section className="section">
        <div className="section-head"><h2>Journal</h2>{v.journal && <span className={v.journal.intact ? "badge" : "badge yolk"}>{v.journal.intact ? "Intact" : "Altéré"}</span>}</div>
        <p className="note">Chaque demande, accord, consultation et fin est notée, scellée à la précédente : la moindre modification se voit. À produire devant un notaire ou un juge si la famille se dispute un jour.</p>
        {journal ? (
          <ul className="list">
            {journal.lignes.slice().reverse().slice(0, 30).map((l, i) => (
              <li key={i}><div className="row-item" style={{ gridTemplateColumns: "1fr auto" }}><div><div className="t">{ACTION[l.action] ?? l.action}</div><div className="s">{l.acteur}</div></div><div className="r" style={{ fontSize: 12 }}>{new Date(l.quand).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</div></div></li>
            ))}
          </ul>
        ) : <button className="link" onClick={async () => setJournal(await api.journalVeille(v.id))}>Afficher le journal</button>}
        {api.journalCsvUrl(v.id) && <a className="link" style={{ display: "inline-block", marginTop: 8, marginLeft: journal ? 0 : 16 }} href={api.journalCsvUrl(v.id)!}>Télécharger (CSV)</a>}
      </section>

      {v.statut !== "terminee" ? (
        <section className="section">
          <div className="section-head"><h2>Arrêter</h2></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={() => terminer("demande_aidant")}>Je ne veux plus veiller</button>
            {v.mesure !== "aucune" && <button className="btn ghost" onClick={() => terminer("fin_mesure")}>La mesure a pris fin</button>}
            <button className="btn ghost" onClick={() => terminer("deces")}>Décès</button>
          </div>
          <p className="note" style={{ marginTop: 8 }}>Au décès, la veille s'arrête : le compte relève alors du notaire, pas de la famille.</p>
        </section>
      ) : <p className="note">Arrêtée le {fmtDate((v.fin_le ?? "").slice(0, 10))} ({MOTIF[v.motif_fin ?? ""] ?? v.motif_fin}).</p>}
    </div>
  );
}

/** Public page of the protected person: plain words, big buttons, her own way out. No account needed. */
export function ConsentPage({ api, jeton }: { api: Api; jeton: string }) {
  const [vue, setVue] = useState<VuePersonne | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [qualite, setQualite] = useState<"personne" | "representant">("personne");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrait, setRetrait] = useState(false);
  const [manque, setManque] = useState<"nom" | "case" | null>(null);
  const [banques, setBanques] = useState<Banque[] | null>(null);
  const connecterBanque = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.banquesVeille(jeton);
      if (r.fournisseur === "enablebanking") { setBanques(r.banques); return; }
    } catch (e) { setErr((e as Error).message); return; } finally { setBusy(false); }
    act(() => api.banqueVeille(jeton));
  };
  const banqueRetour = new URLSearchParams(location.hash.split("?")[1] ?? "").get("banque");
  useEffect(() => {
    api.vuePersonne(jeton).then((v) => { setVue(v); setQualite(v.qui_consent.personne && !v.accords_donnes.includes("personne") ? "personne" : "representant"); }).catch((e) => setErr(e.message));
  }, [jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrap = (body: React.ReactNode) => <div className="app"><div className="screen consent">{<Logo />}{body}</div></div>;
  if (err && !vue) return wrap(<>
    <p className="detail-sub" style={{ marginTop: 20 }}>{err}</p>
    {api.mode === "demo" && <p className="note">Dans la démo, rien n'est enregistré : ouvrez cette page avec le bouton « Ouvrir sa page (démo) » depuis la veille, dans le même onglet. <a className="link" href="#/famille">Aller à Famille</a></p>}
  </>);
  if (!vue) return wrap(<p className="note">Chargement…</p>);
  const act = async (f: () => Promise<Partial<VuePersonne> & { url?: string | null }>) => {
    setBusy(true); setErr(null);
    try { const r = await f(); if (r.url) { location.href = r.url; return; } setVue({ ...vue, ...r } as VuePersonne); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const doitSigner = (vue.qui_consent.personne && !vue.accords_donnes.includes("personne")) || (vue.qui_consent.representant && !vue.accords_donnes.includes("representant"));

  return wrap(
    <>
      <h1 className="detail-title" style={{ fontSize: 30 }}>Bonjour {vue.prenom}</h1>
      {vue.statut === "terminee" ? (
        <p className="detail-sub">La veille de votre compte est arrêtée. Plus personne ne reçoit d'alerte, et vos opérations seront effacées. Vous pouvez fermer cette page.</p>
      ) : (
        <>
          <p className="detail-sub">{vue.aidant}{vue.aidant_qualite ? `, ${vue.aidant_qualite.toLowerCase()},` : ""} vous propose que Nidou surveille votre compte en banque contre les arnaques.</p>

          <section className="section">
            <div className="section-head"><h2>Ce que ça veut dire</h2></div>
            <ul className="consent-list">{vue.engagements.map((e) => <li key={e}>{e}</li>)}</ul>
          </section>

          <section className="section">
            <div className="section-head"><h2>Qui sera prévenu</h2></div>
            <ul className="consent-list">{vue.acces.map((a) => <li key={a.nom}><b>{a.nom}</b> · {a.role}</li>)}</ul>
            <p className="note">Ils reçoivent un message si un virement part vers un inconnu, si un coupon prépayé est acheté, ou si des retraits inhabituels s'enchaînent.</p>
          </section>

          {doitSigner && vue.statut !== "active" && (
            <section className="section">
              <div className="section-head"><h2>Votre accord</h2></div>
              <p className="note">{vue.qui_consent.texte}</p>
              {vue.qui_consent.personne && vue.qui_consent.representant && (
                <div className="pills">
                  <button className="pill" aria-pressed={qualite === "personne"} disabled={vue.accords_donnes.includes("personne")} onClick={() => setQualite("personne")}>Je suis {vue.prenom}</button>
                  <button className="pill" aria-pressed={qualite === "representant"} disabled={vue.accords_donnes.includes("representant")} onClick={() => setQualite("representant")}>Je suis le curateur</button>
                </div>
              )}
              <div className="fields"><div className="field"><span>{qualite === "personne" ? "Votre nom" : "Nom du représentant"}</span><input id="nom-signataire" value={nom} placeholder="Écrivez votre nom ici" onChange={(e) => { setNom(e.target.value); setManque(null); }} autoComplete="name" style={manque === "nom" ? { outline: "2px solid var(--ember)", borderRadius: 10 } : undefined} /></div></div>
              <label style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10, alignItems: "start", fontSize: 17, margin: "6px 0 14px" }}>
                <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 22, height: 22 }} />
                <span>{qualite === "personne" ? "J'ai compris et je suis d'accord. Je sais que je peux arrêter quand je veux." : `J'autorise la veille en ma qualité de représentant légal de ${vue.prenom}, qui en a été informée.`}</span>
              </label>
              <button className="btn" style={{ fontSize: 18, padding: "14px 22px" }} disabled={busy} onClick={() => {
                if (nom.trim().length < 2) { setManque("nom"); document.getElementById("nom-signataire")?.focus(); return; }
                if (!ok) { setManque("case"); return; }
                act(() => api.consentirVeille(jeton, { nom_signataire: nom, en_qualite_de: qualite, accepte: ok }));
              }}>Je donne mon accord</button>
              {manque && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>{manque === "nom" ? "Écrivez d'abord votre nom, c'est votre signature." : "Cochez la case pour confirmer votre accord."}</p>}
              <p className="note" style={{ marginTop: 10 }}>Vous pouvez aussi ne rien faire : sans accord, rien ne se passe.</p>
            </section>
          )}

          {vue.statut === "attente_consentement" && !doitSigner && <div className="confidence ok" style={{ display: "block" }}>Votre accord est noté. La veille démarre dès que l'autre accord est donné.</div>}

          {vue.statut === "active" && (
            <section className="section">
              <div className="section-head"><h2>Votre banque</h2>{vue.banque_connectee && <span className="badge">Connectée</span>}</div>
              {vue.banque_connectee ? <p className="note">Votre compte est suivi en lecture seule.{banqueRetour === "ok" ? " Merci, c'est fait." : ""}</p> : (
                <>
                  <p className="note">Connectez vous-même votre banque, avec vos codes habituels, sur la page sécurisée de notre partenaire agréé. Ne donnez jamais vos codes à quelqu'un, même de votre famille.</p>
                  {banques ? (
                    <>
                      <p className="note">Choisissez votre banque. Vous arriverez sur sa page habituelle, où vous vous connectez comme d'habitude.</p>
                      <BankPicker large banques={banques} busy={busy} onPick={(b) => act(() => api.banqueVeille(jeton, b))} />
                    </>
                  ) : <button className="btn" style={{ fontSize: 18, padding: "14px 22px" }} disabled={busy} onClick={connecterBanque}>{busy ? "Un instant…" : "Connecter ma banque"}</button>}
                </>
              )}
              {vue.consentement_expire && <p className="note">Accord donné le {fmtDate(vue.consentement_le!.slice(0, 10))}, valable jusqu'au {fmtDate(vue.consentement_expire.slice(0, 10))}.</p>}
            </section>
          )}

          {vue.derniers_acces.length > 0 && (
            <section className="section">
              <div className="section-head"><h2>Dernières consultations</h2></div>
              <ul className="consent-list">{vue.derniers_acces.slice().reverse().map((a, i) => <li key={i}>{a.qui} · {new Date(a.quand).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}</li>)}</ul>
            </section>
          )}

          {err && <div className="confidence" style={{ display: "block" }}>{err}</div>}

          {(vue.statut === "active" || vue.statut === "suspendue" || vue.accords_donnes.length > 0) && (
            <section className="section">
              <div className="section-head"><h2>Tout arrêter</h2></div>
              {!retrait ? <button className="btn ghost" style={{ fontSize: 17 }} onClick={() => setRetrait(true)}>Je ne veux plus de cette veille</button> : (
                <>
                  <p className="note">C'est votre droit, sans avoir à vous justifier. Les alertes s'arrêtent tout de suite et {vue.aidant} est prévenu{vue.temoins.length ? ", ainsi que les témoins" : ""}.</p>
                  <button className="btn danger" style={{ fontSize: 17 }} disabled={busy} onClick={() => act(() => api.retirerVeille(jeton, vue.prenom))}>Oui, tout arrêter</button>
                </>
              )}
            </section>
          )}
        </>
      )}
      {api.mode === "demo" && (
        <div className="confidence" style={{ display: "block", marginTop: 20 }}>
          Démo : ici, vous voyez la page que recevrait {vue.prenom}. <button className="link" onClick={() => history.back()}>Revenir à la veille côté aidant</button>
        </div>
      )}
      <p className="note" style={{ marginTop: 24 }}>Nidou · nid « {vue.nid} ». Une question, un doute sur cette page : appelez votre banque au numéro inscrit sur votre carte, jamais un numéro reçu par message.</p>
    </>
  );
}
