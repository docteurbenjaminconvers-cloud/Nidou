import { mettreAJour, useNouvelleVersion } from "./miseAJour";
import { SituationDetail, Situations } from "./screens/Situations";
import { DocumentsLocation, PageSignature } from "./screens/Location";
import { PageAdmin } from "./screens/Admin";
import { VerifPro } from "./screens/VerifPro";
import { langueChoisie } from "./i18n/traduction";
import { PageComptable } from "./screens/Comptable";
import { Offre } from "./screens/Offre";
import { EspaceBudget } from "./screens/EspaceBudget";
import { EspacePro } from "./screens/EspacePro";
import { EspaceLocatif } from "./screens/EspaceLocatif";
import { FamilleCtx } from "./menuFamille";
import { useCallback, useEffect, useState } from "react";
import { getApi, type Api } from "./api";
import type { BudgetReport, ChargesReport, Deadline, Doc, Household } from "./types";
import { Today } from "./screens/Today";
import { AgendaTelephone, Deadlines } from "./screens/Deadlines";
import { Documents } from "./screens/Documents";
import { DocumentDetail } from "./screens/DocumentDetail";
import { Add } from "./screens/Add";
import { Budget } from "./screens/Budget";
import { Settings } from "./screens/Settings";
import { Assistant } from "./screens/Assistant";
import { Connecteur } from "./screens/Connecteur";
import { Logo } from "./ui";
import { useNotifications, NotificationsScreen } from "./notifications";
import { Reveal, REVEAL_KEY } from "./screens/Reveal";
import { Famille, MembreDetail, ActiviteDetail } from "./screens/Famille";
import { Login } from "./screens/Login";
import { Semaine, calculerSemaine } from "./screens/Semaine";
import { Dossier, Dossiers } from "./screens/Dossiers";
import { Menage } from "./screens/Menage";
import { Partages } from "./screens/Partages";
import { CoupDur, Urgence } from "./screens/Urgence";
import { ConsentPage, VeilleDetail, VeilleNouvelle } from "./screens/Veille";
import { ApiError } from "./api";
import type { FamilleReport } from "./types";

type Route = { s: string; id?: string };
let revealShown = false;

const TabIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

/** The app's language is sent once per launch: emails and notifications follow it. */
let langueEnvoyee = false;

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash());
  const ordi = useOrdi();
  const [household, setHousehold] = useState<Household | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [charges, setCharges] = useState<ChargesReport | null>(null);
  const [budget, setBudget] = useState<BudgetReport | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [famille, setFamille] = useState<FamilleReport | null>(null);
  const [login, setLogin] = useState<string | null | false>(false);
  const [pause, setPause] = useState<string | null>(null); // false: unknown/no, string|null: show login (with optional error code)

  const notifs = useNotifications(deadlines, docs, budget, household, charges);
  const nouvelleVersion = useNouvelleVersion();
  const toast = useCallback((m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); }, []);

  const reload = useCallback(async (a = api) => {
    if (!a) return;
    try {
    const [h, d, dl, c, b, f] = await Promise.all([a.household(), a.documents(), a.deadlines(), a.charges(), a.budget().catch(() => null), a.famille().catch(() => null)]);
    setHousehold(h); setDocs(d); setDeadlines(dl); setCharges(c); setBudget(b); setFamille(f);
    if (!langueEnvoyee) { langueEnvoyee = true; a.enregistrerLangue(langueChoisie()); }
    // First time real spending data arrives (bank connected or statement imported): the savings reveal, once.
    // Demo: the reveal plays once per visit (not on every reload of the data); for real accounts, once ever.
    let seen = revealShown; try { seen = seen || (a.mode !== "demo" && localStorage.getItem(REVEAL_KEY) === "1"); } catch {}
    if (b && b.nb_transactions > 0 && b.economies_possibles > 0 && !seen && h.plan === "famille") {
      revealShown = true;
      try { localStorage.setItem(REVEAL_KEY, "1"); } catch {}
      setReveal(true);
    }
    setLogin(false);
    // a partner code captured from the link the accountant shared (?partenaire=CODE), applied once logged in
    try {
      const code = localStorage.getItem("lucien.partenaire");
      if (code && !h.abonnement?.statut) { localStorage.removeItem("lucien.partenaire"); a.setPartenaire(code).then(() => toast("Code de votre comptable enregistré : premier mois offert")).catch(() => {}); }
    } catch { /* storage refused */ }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setLogin(new URLSearchParams(location.hash.split("?")[1] ?? "").get("erreur")); return; }
      if (e instanceof ApiError && e.code === "compte_en_pause") { setPause(e.message); return; }
      throw e;
    }
  }, [api]);

  useEffect(() => { getApi().then((a) => { setApi(a); reload(a); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
    if (q.get("paiement") === "ok") { toast("Bienvenue dans la formule complète"); location.hash = "#/settings"; }
    if (q.get("paiement") === "annule") { toast("Paiement annulé, rien n'a été débité"); location.hash = "#/settings"; }
    if (q.get("bank") === "deja") { toast("Cette banque est déjà connectée : rien n'a été ajouté en double"); location.hash = "#/budget"; }
    if (q.get("bank") === "abandon") { toast("Connexion à la banque interrompue, rien n'a changé"); location.hash = "#/budget"; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // The screen seen just before (name only, never an id): attached to a message to the team when the person agrees.
    const onHash = (e: HashChangeEvent) => { try { sessionStorage.setItem("lucien.page.precedente", new URL(e.oldURL).hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "home"); } catch { /* */ } setRoute(parseHash()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (s: string, id?: string) => { location.hash = id ? `${s}/${id}` : s; document.getElementById("root")?.scrollTo({ top: 0 }); };
  const onDone = async (id: string) => { await api!.setDeadlineDone(id, true); toast("Marqué comme fait"); reload(); };

  // The protected person's own page: no account, no household loaded, just her link.
  if (api && route.s === "consentement" && route.id) return <ConsentPage api={api} jeton={route.id.split("?")[0]} />;
  if (api && route.s === "comptable" && route.id) return <PageComptable api={api} token={route.id} />;
  if (api && route.s === "signer" && route.id) return <PageSignature api={api} jeton={route.id.split("?")[0]} />;
  if (api && route.s === "admin") return <PageAdmin api={api} />;
  if (api && login !== false) return <Login api={api} erreur={login} />;
  if (api && pause) return (
    <div className="app"><div className="screen" style={{ minHeight: "85dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
      <Logo />
      <h1 className="detail-title">Votre accès est en pause</h1>
      <p className="detail-sub">{pause}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={() => { setPause(null); reload(); }}>Réessayer</button>
        <button className="btn ghost" onClick={async () => { await api.deconnexion(); location.reload(); }}>Se déconnecter</button>
      </div>
    </div></div>
  );
  if (!api || !household) {
    return (
      <div className="app"><div className="screen" style={{ display: "grid", placeItems: "center", minHeight: "70dvh" }}><Logo /></div></div>
    );
  }

  const tab = route.s === "dossiers" || route.s === "dossier" || route.s === "menage" ? "docs" : route.s === "doc" || route.s === "add" ? "" : route.s === "membre" || route.s === "activite" || route.s === "veille" || route.s === "veille-nouvelle" || route.s === "partages" ? "famille" : route.s;

  return (
    <FamilleCtx.Provider value={{ api, famille, household, go }}>
    <div className="app">
      {route.s === "deadlines" && <Deadlines api={api} membres={famille?.membres} deadlines={deadlines} go={go} onDone={onDone} unread={notifs.unread} semaine={famille?.semaine} extra={<AgendaTelephone api={api} deadlines={deadlines} famille={famille} household={household} toast={toast} />} />}
      {route.s === "famille" && <Famille api={api} household={household} go={go} unread={notifs.unread} onChanged={reload} toast={toast} sel={route.id} docs={docs} deadlines={deadlines} />}
      {route.s === "membre" && route.id && <MembreDetail api={api} id={route.id} onBack={() => go("famille", route.id)} go={go} onChanged={reload} toast={toast} />}
      {route.s === "activite" && route.id && <ActiviteDetail api={api} id={route.id} onBack={() => history.length > 1 ? history.back() : go("famille")} onChanged={reload} toast={toast} />}
      {route.s === "veille-nouvelle" && route.id && <VeilleNouvelle api={api} memberId={route.id} onBack={() => go("membre", route.id)} go={go} toast={toast} />}
      {route.s === "veille" && route.id && <VeilleDetail api={api} id={route.id} onBack={() => history.length > 1 ? history.back() : go("famille")} toast={toast} />}
      {route.s === "docs" && <Documents docs={docs} go={go} unread={notifs.unread} />}
      {route.s === "doc" && route.id && <DocumentDetail api={api} id={route.id} onBack={() => history.length > 1 ? history.back() : go("docs")} onChanged={reload} toast={toast} />}
      {route.s === "add" && <Add api={api} household={household} docs={docs} go={go} onBack={() => go("home")} onAdded={(id) => { reload(); go("doc", id); }} toast={toast} />}
      {route.s === "budget" && <Budget api={api} charges={charges} budget={budget} household={household} go={go} onUpgrade={() => go("settings")} onChanged={reload} toast={toast} unread={notifs.unread} />}
      {route.s === "notifs" && <NotificationsScreen items={notifs.items} read={notifs.read} markRead={notifs.markRead} markAll={notifs.markAll} go={go} onBack={() => go("home")} api={api} toast={toast} />}
      {route.s === "assistant" && <Assistant api={api} household={household} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} onChanged={reload} toast={toast} />}
      {route.s === "urgence" && <Urgence docs={docs} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} />}
      {route.s === "coup-dur" && route.id && <CoupDur cle={route.id} docs={docs} go={go} onBack={() => go("urgence")} />}
      {route.s === "menage" && <Menage api={api} docs={docs} go={go} onBack={() => go("docs")} onChanged={reload} toast={toast} />}
      {route.s === "dossiers" && <Dossiers docs={docs} go={go} onBack={() => go("docs")} />}
      {route.s === "partages" && <Partages api={api} onBack={() => history.back()} toast={toast} />}
      {route.s === "dossier" && route.id && <Dossier cle={route.id} api={api} household={household} docs={docs} go={go} onBack={() => go("dossiers")} toast={toast} />}
      {route.s === "offre" && <Offre api={api} household={household} focus={route.id} onBack={() => history.length > 1 ? history.back() : go("home")} onChange={reload} toast={toast} />}
      {route.s === "espace" && route.id === "budget" && <EspaceBudget api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "espace" && route.id === "pro" && <EspacePro api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "verif-pro" && <VerifPro api={api} onBack={() => (history.length > 1 ? history.back() : go("budget"))} toast={toast} />}
      {route.s === "situations" && <Situations api={api} go={go} onBack={() => go("home")} onChanged={reload} toast={toast} />}
      {route.s === "situation" && route.id && <SituationDetail api={api} id={route.id} go={go} onBack={() => go("situations")} onChanged={reload} toast={toast} />}
      {route.s === "location" && route.id && <DocumentsLocation api={api} bienId={route.id} go={go} onBack={() => history.length > 1 ? history.back() : go("espace", "locatif")} toast={toast} />}
      {route.s === "espace" && route.id === "locatif" && <EspaceLocatif api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "semaine" && <Semaine point={calculerSemaine(household, deadlines, docs, budget, famille)} household={household} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} />}
      {route.s === "connecteur" && <Connecteur household={household} go={go} onBack={() => history.length > 1 ? history.back() : go("settings")} toast={toast} />}
      {route.s === "settings" && <Settings api={api} household={household} onBack={() => go("home")} onPlan={() => reload()} toast={toast} go={go} />}
      {(route.s === "home" || !["deadlines", "docs", "doc", "add", "budget", "settings", "notifs", "famille", "membre", "activite", "veille", "veille-nouvelle", "assistant", "connecteur", "semaine", "dossiers", "dossier", "menage", "urgence", "coup-dur", "offre", "espace", "partages", "location", "situations", "situation", "verif-pro"].includes(route.s) || (!route.id && ["membre", "activite", "veille", "veille-nouvelle", "doc", "dossier", "coup-dur", "espace", "situation", "location"].includes(route.s))) && (
        <Today api={api} household={household} deadlines={deadlines} docs={docs} charges={charges} budget={budget} go={go} onDone={onDone} unread={notifs.unread} famille={famille} />
      )}

      <nav className="tabs" aria-label="Navigation">
        <div className="tabs-inner">
          <div className="tabs-marque" aria-hidden="true"><Logo /></div>
          <button className="tab" aria-current={(ordi ? ["home", "notifs", "semaine", "urgence", "coup-dur", "espace", "location", "situations", "situation"] : ["home", "settings", "notifs", "semaine", "urgence", "coup-dur", "offre", "espace", "location", "situations", "situation", "famille", "assistant", "connecteur"]).includes(tab) ? "page" : undefined} onClick={() => go("home")}><TabIcon d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" />Aujourd'hui</button>
          <button className="tab" aria-current={tab === "deadlines" ? "page" : undefined} onClick={() => go("deadlines")}><TabIcon d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 14l2 2 4-4" />Agenda</button>
          <button className="tab-add" aria-label="Ajouter un papier" onClick={() => go("add")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg><span className="tab-add-texte">Ajouter un papier</span></button>
          <button className="tab" aria-current={tab === "docs" ? "page" : undefined} onClick={() => go("docs")}><TabIcon d="M4 4h10l6 6v10H4zM14 4v6h6M8 13h8M8 17h5" />Papiers</button>
          <button className="tab" aria-current={tab === "budget" || tab === "verif-pro" ? "page" : undefined} onClick={() => go("budget")}><TabIcon d="M3 20h18M6 16V9M11 16V5M16 16v-7M21 16v-4" />Budget</button>
          {/* on a computer the side bar has room for the rest of Lucien */}
          <button className="tab ordi" aria-current={tab === "famille" ? "page" : undefined} onClick={() => go("famille")}><TabIcon d="M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9" />Famille</button>
          <button className="tab ordi" aria-current={tab === "assistant" ? "page" : undefined} onClick={() => go("assistant")}><TabIcon d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />Demander à Lucien</button>
          <span className="tabs-espace ordi" />
          <button className="tab ordi" aria-current={tab === "offre" ? "page" : undefined} onClick={() => go("offre")}><TabIcon d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z" />L'offre</button>
          <button className="tab ordi" aria-current={tab === "settings" || tab === "connecteur" ? "page" : undefined} onClick={() => go("settings")}><TabIcon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />Réglages</button>
        </div>
      </nav>
      {reveal && budget && <Reveal budget={budget} onClose={() => setReveal(false)} go={go} toast={toast} />}
      {nouvelleVersion && <button className="maj-pastille" onClick={() => { toast("Mise à jour…"); mettreAJour(); }}><b>Nouvelle version de Lucien</b><span>Mettre à jour</span></button>}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
    </FamilleCtx.Provider>
  );
}

function parseHash(): Route {
  const [s, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { s: s || "home", id };
}

/** True on a computer-sized screen (side bar instead of the bottom tab bar). */
function useOrdi() {
  const q = "(min-width: 1024px)";
  const [v, setV] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q); const f = () => setV(m.matches);
    m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f);
  }, []);
  return v;
}
