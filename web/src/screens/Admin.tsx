import { useEffect, useMemo, useState } from "react";
import type { Api } from "../api";

/** Lucien's own back office (not the families'): partner accounting firms. Opened at #/admin with LUCIEN_ADMIN_TOKEN. */
type Statut = "en_attente" | "valide" | "refuse";
interface CabinetAdmin { code: string; nom: string; email: string; ville: string | null; statut: Statut; cree_le: string; clients: number; abonnes: number }
interface Resume { cabinets: { en_attente: number; valides: number; refuses: number }; via_cabinets: { foyers: number; abonnes: number }; foyers: { total: number; abonnes: number }; ia: { gratuit_eur: number; payant_eur: number } }

const STATUT: Record<Statut, string> = { en_attente: "À valider", valide: "Validé", refuse: "Refusé" };
const CLE = "lucien.admin";
const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** In the demo there is no server: a few sample firms so the page can be tried. */
function demo() {
  const j = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
  let liste: CabinetAdmin[] = [
    { code: "DURA-7KQ2", nom: "Cabinet Durand & associés", email: "contact@durand-expertise.fr", ville: "Montpellier", statut: "en_attente", cree_le: j(1), clients: 0, abonnes: 0 },
    { code: "AGAO-M4XP", nom: "AGA Occitanie", email: "adhesion@aga-occitanie.fr", ville: "Toulouse", statut: "en_attente", cree_le: j(3), clients: 0, abonnes: 0 },
    { code: "FIDU-9TRB", nom: "Fiducial Nîmes", email: "nimes@exemple-fiducial.fr", ville: "Nîmes", statut: "valide", cree_le: j(40), clients: 14, abonnes: 9 },
    { code: "COMP-2HWN", nom: "Compta Sud Conseil", email: "bonjour@comptasud.fr", ville: "Uzès", statut: "valide", cree_le: j(65), clients: 6, abonnes: 5 },
    { code: "TEST-QQQQ", nom: "Test test", email: "test@test.com", ville: null, statut: "refuse", cree_le: j(20), clients: 0, abonnes: 0 },
  ];
  const resume = (): Resume => ({
    cabinets: { en_attente: liste.filter((x) => x.statut === "en_attente").length, valides: liste.filter((x) => x.statut === "valide").length, refuses: liste.filter((x) => x.statut === "refuse").length },
    via_cabinets: { foyers: liste.reduce((s, x) => s + x.clients, 0), abonnes: liste.reduce((s, x) => s + x.abonnes, 0) },
    foyers: { total: 412, abonnes: 187 }, ia: { gratuit_eur: 18.4, payant_eur: 96.2 },
  });
  return {
    async charger() { return { liste: [...liste], resume: resume() }; },
    async statut(code: string, statut: Statut) { liste = liste.map((x) => (x.code === code ? { ...x, statut } : x)); return { envoye: statut === "valide" }; },
    async modifier(code: string, p: Partial<CabinetAdmin>) { liste = liste.map((x) => (x.code === code ? { ...x, ...p } : x)); },
    async ajouter(p: { nom: string; email: string; ville: string }) { const code = `${p.nom.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X")}-DEMO`; liste = [{ code, ...p, ville: p.ville || null, statut: "valide", cree_le: new Date().toISOString(), clients: 0, abonnes: 0 }, ...liste]; return { code, envoye: true }; },
    async renvoyer() { return { envoye: true }; },
    async csv() { return null; },
  };
}

function serveur(jeton: string) {
  const h = { authorization: `Bearer ${jeton}`, "content-type": "application/json" };
  const appel = async <T,>(chemin: string, init: RequestInit = {}): Promise<T> => {
    const r = await fetch(`/api${chemin}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } });
    if (r.status === 403) throw new Error("Code d'administration incorrect.");
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Erreur ${r.status}`);
    return r.json();
  };
  return {
    async charger() { const [liste, resume] = await Promise.all([appel<CabinetAdmin[]>("/admin/partenaires"), appel<Resume>("/admin/resume")]); return { liste, resume }; },
    statut: (code: string, statut: Statut) => appel<{ envoye: boolean }>(`/admin/partenaires/${code}`, { method: "POST", body: JSON.stringify({ statut, envoyer_email: statut === "valide" }) }),
    modifier: (code: string, p: Partial<CabinetAdmin>) => appel(`/admin/partenaires/${code}`, { method: "PATCH", body: JSON.stringify(p) }),
    ajouter: (p: { nom: string; email: string; ville: string }) => appel<{ code: string; envoye: boolean }>("/admin/partenaires", { method: "POST", body: JSON.stringify({ ...p, envoyer_email: true }) }),
    renvoyer: (code: string) => appel<{ envoye: boolean }>(`/admin/partenaires/${code}/email`, { method: "POST" }),
    async csv() { const r = await fetch("/api/admin/partenaires.csv", { headers: h }); return r.ok ? r.blob() : null; },
  };
}

export function PageAdmin({ api }: { api: Api }) {
  const enDemo = api.mode === "demo";
  const [jeton, setJeton] = useState<string>(() => { try { return sessionStorage.getItem(CLE) ?? ""; } catch { return ""; } });
  const [saisie, setSaisie] = useState("");
  const [data, setData] = useState<{ liste: CabinetAdmin[]; resume: Resume } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Statut | "tous">("en_attente");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [edition, setEdition] = useState<CabinetAdmin | null>(null);
  const [ajout, setAjout] = useState<{ nom: string; email: string; ville: string } | null>(null);
  const client = useMemo(() => (enDemo ? demo() : jeton ? serveur(jeton) : null), [enDemo, jeton]);
  const recharger = async () => { if (!client) return; try { setData(await client.charger()); setErr(null); } catch (e) { setErr((e as Error).message); if (!enDemo) { setJeton(""); try { sessionStorage.removeItem(CLE); } catch { /* */ } } } };
  useEffect(() => { recharger(); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && filtre === "en_attente" && data.resume.cabinets.en_attente === 0) setFiltre("tous"); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };

  if (!client) return (
    <div className="app admin"><div className="screen admin-connexion">
      <p className="admin-marque">Lucien · administration</p>
      <h1 className="detail-title">Cabinets partenaires</h1>
      <p className="detail-sub">Réservé à l'équipe Lucien. Saisissez le code d'administration (variable LUCIEN_ADMIN_TOKEN du serveur).</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!saisie.trim()) return; try { sessionStorage.setItem(CLE, saisie.trim()); } catch { /* */ } setJeton(saisie.trim()); }}>
        <input className="in" type="password" autoComplete="current-password" value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Code d'administration" />
        <button className="btn block" style={{ marginTop: 10 }}>Ouvrir</button>
      </form>
      {err && <p className="note" style={{ color: "var(--ember)" }}>{err}</p>}
    </div></div>
  );

  const liste = (data?.liste ?? []).filter((c) => (filtre === "tous" || c.statut === filtre) && (!q.trim() || `${c.nom} ${c.email} ${c.ville ?? ""} ${c.code}`.toLowerCase().includes(q.trim().toLowerCase())));
  const r = data?.resume;
  const agir = async (c: CabinetAdmin, statut: Statut) => {
    try { const x = await client.statut(c.code, statut); info(statut === "valide" ? `${c.nom} validé${x.envoye ? " : code envoyé par email" : " (email non envoyé : service d'email non configuré)"}` : `${c.nom} : ${STATUT[statut].toLowerCase()}`); await recharger(); }
    catch (e) { info((e as Error).message); }
  };

  return (
    <div className="app admin"><div className="screen admin-page">
      <div className="admin-tete">
        <div><p className="admin-marque">Lucien · administration</p><h1 className="detail-title">Cabinets partenaires</h1></div>
        <div className="admin-tete-actions">
          {!enDemo && <button className="btn ghost" onClick={async () => { const b = await client.csv(); if (!b) return; const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "cabinets-partenaires.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }}>Exporter (CSV)</button>}
          <button className="btn" onClick={() => setAjout({ nom: "", email: "", ville: "" })}>+ Ajouter un cabinet</button>
          {!enDemo && <button className="link" onClick={() => { try { sessionStorage.removeItem(CLE); } catch { /* */ } setJeton(""); setData(null); }}>Se déconnecter</button>}
        </div>
      </div>
      {enDemo && <p className="confidence">Démonstration : cabinets fictifs. Sur le serveur, cette page affiche les vraies demandes.</p>}
      {err && <p className="note" style={{ color: "var(--ember)" }}>{err}</p>}

      {r && (
        <div className="admin-chiffres">
          <div className={r.cabinets.en_attente ? "alerte" : ""}><b>{r.cabinets.en_attente}</b><span>à valider</span></div>
          <div><b>{r.cabinets.valides}</b><span>cabinets partenaires</span></div>
          <div><b>{r.via_cabinets.foyers}</b><span>foyers venus par un cabinet</span><small>{r.via_cabinets.abonnes} abonnés</small></div>
          <div><b>{r.foyers.total}</b><span>foyers en tout</span><small>{r.foyers.abonnes} abonnés</small></div>
          <div><b>{(r.ia.gratuit_eur + r.ia.payant_eur).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €</b><span>dépense d'IA ce mois-ci</span><small>dont essais {r.ia.gratuit_eur.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €</small></div>
        </div>
      )}

      {ajout && (
        <form className="admin-form" onSubmit={async (e) => { e.preventDefault(); try { const x = await client.ajouter(ajout); info(`Cabinet ajouté, code ${x.code}${x.envoye ? ", envoyé par email" : ""}`); setAjout(null); await recharger(); } catch (x) { info((x as Error).message); } }}>
          <b>Ajouter un cabinet (validé tout de suite, code envoyé par email)</b>
          <input className="in" required placeholder="Nom du cabinet" value={ajout.nom} onChange={(e) => setAjout({ ...ajout, nom: e.target.value })} />
          <input className="in" required type="email" placeholder="Email" value={ajout.email} onChange={(e) => setAjout({ ...ajout, email: e.target.value })} />
          <input className="in" placeholder="Ville" value={ajout.ville} onChange={(e) => setAjout({ ...ajout, ville: e.target.value })} />
          <div className="admin-form-actions"><button className="btn">Ajouter</button><button type="button" className="btn ghost" onClick={() => setAjout(null)}>Annuler</button></div>
        </form>
      )}

      <div className="admin-filtres">
        <div className="pills">
          {(["en_attente", "valide", "refuse", "tous"] as const).map((f) => (
            <button key={f} className="pill" aria-pressed={filtre === f} onClick={() => setFiltre(f)}>
              {f === "tous" ? "Tous" : STATUT[f]}{r && f !== "tous" ? ` (${f === "en_attente" ? r.cabinets.en_attente : f === "valide" ? r.cabinets.valides : r.cabinets.refuses})` : ""}
            </button>
          ))}
        </div>
        <input className="in" type="search" placeholder="Chercher un cabinet, un email, un code" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!data ? <p className="note">Chargement…</p> : liste.length === 0 ? <p className="note">{filtre === "en_attente" ? "Aucune demande à valider." : "Aucun cabinet."}</p> : (
        <div className="admin-liste">
          {liste.map((c) => edition?.code === c.code ? (
            <form key={c.code} className="admin-carte admin-form" onSubmit={async (e) => { e.preventDefault(); try { await client.modifier(c.code, { nom: edition.nom, email: edition.email, ville: edition.ville }); setEdition(null); info("Cabinet modifié"); await recharger(); } catch (x) { info((x as Error).message); } }}>
              <input className="in" required value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} />
              <input className="in" required type="email" value={edition.email} onChange={(e) => setEdition({ ...edition, email: e.target.value })} />
              <input className="in" value={edition.ville ?? ""} placeholder="Ville" onChange={(e) => setEdition({ ...edition, ville: e.target.value })} />
              <div className="admin-form-actions"><button className="btn">Enregistrer</button><button type="button" className="btn ghost" onClick={() => setEdition(null)}>Annuler</button></div>
            </form>
          ) : (
            <div key={c.code} className={`admin-carte ${c.statut}`}>
              <div className="admin-carte-tete">
                <div><b>{c.nom}</b><span>{c.ville ?? "Ville non indiquée"} · inscrit le {dateFr(c.cree_le)}</span></div>
                <span className={`statut-cab ${c.statut}`}>{STATUT[c.statut]}</span>
              </div>
              <div className="admin-carte-infos">
                <a href={`mailto:${c.email}`}>{c.email}</a>
                <span>Code <code>{c.code}</code></span>
                <span>{c.clients} foyer{c.clients > 1 ? "s" : ""} · {c.abonnes} abonné{c.abonnes > 1 ? "s" : ""}</span>
              </div>
              <div className="admin-carte-actions">
                {c.statut !== "valide" && <button className="btn" onClick={() => agir(c, "valide")}>Valider et envoyer le code</button>}
                {c.statut === "en_attente" && <button className="btn ghost" onClick={() => agir(c, "refuse")}>Refuser</button>}
                {c.statut === "valide" && <button className="btn ghost" onClick={async () => { const x = await client.renvoyer(c.code).catch((e) => { info((e as Error).message); return null; }); if (x) info(x.envoye ? "Code renvoyé par email" : "Email non envoyé : service d'email non configuré"); }}>Renvoyer le code</button>}
                {c.statut === "valide" && <button className="link" onClick={() => agir(c, "refuse")}>Désactiver</button>}
                {c.statut === "refuse" && <button className="link" onClick={() => agir(c, "en_attente")}>Remettre à valider</button>}
                <button className="link" onClick={() => setEdition(c)}>Modifier</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="note" style={{ marginTop: 18 }}>Un cabinet validé reçoit son code par email. Ses clients le saisissent dans Réglages et ont le premier mois offert à leur premier abonnement. Désactiver un cabinet coupe l'avantage pour les nouveaux abonnements, sans toucher aux abonnements en cours.</p>
      {msg && <div className="toast" role="status">{msg}</div>}
    </div></div>
  );
}
