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
import { CoupDur, Urgence } from "./screens/Urgence";
import { ConsentPage, VeilleDetail, VeilleNouvelle } from "./screens/Veille";
import { ApiError } from "./api";
import type { FamilleReport } from "./types";

type Route = { s: string; id?: string };
let revealShown = false;

const TabIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash());
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
  const toast = useCallback((m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); }, []);

  const reload = useCallback(async (a = api) => {
    if (!a) return;
    try {
    const [h, d, dl, c, b, f] = await Promise.all([a.household(), a.documents(), a.deadlines(), a.charges(), a.budget().catch(() => null), a.famille().catch(() => null)]);
    setHousehold(h); setDocs(d); setDeadlines(dl); setCharges(c); setBudget(b); setFamille(f);
    // First time real spending data arrives (bank connected or statement imported): the savings reveal, once.
    // Demo: the reveal plays once per visit (not on every reload of the data); for real accounts, once ever.
    let seen = revealShown; try { seen = seen || (a.mode !== "demo" && localStorage.getItem(REVEAL_KEY) === "1"); } catch {}
    if (b && b.nb_transactions > 0 && b.economies_possibles > 0 && !seen && h.plan === "famille") {
      revealShown = true;
      try { localStorage.setItem(REVEAL_KEY, "1"); } catch {}
      setReveal(true);
    }
    setLogin(false);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (s: string, id?: string) => { location.hash = id ? `${s}/${id}` : s; window.scrollTo({ top: 0 }); };
  const onDone = async (id: string) => { await api!.setDeadlineDone(id, true); toast("Marqué comme fait"); reload(); };

  // The protected person's own page: no account, no household loaded, just her link.
  if (api && route.s === "consentement" && route.id) return <ConsentPage api={api} jeton={route.id.split("?")[0]} />;
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

  const tab = route.s === "dossiers" || route.s === "dossier" || route.s === "menage" ? "docs" : route.s === "doc" || route.s === "add" ? "" : route.s === "membre" || route.s === "activite" || route.s === "veille" || route.s === "veille-nouvelle" ? "famille" : route.s;

  return (
    <FamilleCtx.Provider value={{ api, famille, household, go }}>
    <div className="app">
      {route.s === "deadlines" && <Deadlines deadlines={deadlines} go={go} onDone={onDone} unread={notifs.unread} semaine={famille?.semaine} extra={<AgendaTelephone api={api} deadlines={deadlines} famille={famille} household={household} toast={toast} />} />}
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
      {route.s === "dossier" && route.id && <Dossier cle={route.id} api={api} household={household} docs={docs} go={go} onBack={() => go("dossiers")} toast={toast} />}
      {route.s === "offre" && <Offre api={api} household={household} focus={route.id} onBack={() => history.length > 1 ? history.back() : go("home")} onChange={reload} toast={toast} />}
      {route.s === "espace" && route.id === "budget" && <EspaceBudget api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "espace" && route.id === "pro" && <EspacePro api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "espace" && route.id === "locatif" && <EspaceLocatif api={api} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} toast={toast} />}
      {route.s === "semaine" && <Semaine point={calculerSemaine(household, deadlines, docs, budget, famille)} household={household} go={go} onBack={() => history.length > 1 ? history.back() : go("home")} />}
      {route.s === "connecteur" && <Connecteur household={household} go={go} onBack={() => history.length > 1 ? history.back() : go("settings")} toast={toast} />}
      {route.s === "settings" && <Settings api={api} household={household} onBack={() => go("home")} onPlan={() => reload()} toast={toast} go={go} />}
      {(route.s === "home" || !["deadlines", "docs", "doc", "add", "budget", "settings", "notifs", "famille", "membre", "activite", "veille", "veille-nouvelle", "assistant", "connecteur", "semaine", "dossiers", "dossier", "menage", "urgence", "coup-dur", "offre", "espace"].includes(route.s)) && (
        <Today api={api} household={household} deadlines={deadlines} docs={docs} charges={charges} budget={budget} go={go} onDone={onDone} unread={notifs.unread} famille={famille} />
      )}

      <nav className="tabs" aria-label="Navigation">
        <div className="tabs-inner">
          <button className="tab" aria-current={tab === "home" || tab === "settings" || tab === "notifs" || tab === "semaine" || tab === "urgence" || tab === "coup-dur" || tab === "offre" || tab === "espace" || tab === "famille" || tab === "assistant" || tab === "connecteur" ? "page" : undefined} onClick={() => go("home")}><TabIcon d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" />Aujourd'hui</button>
          <button className="tab" aria-current={tab === "deadlines" ? "page" : undefined} onClick={() => go("deadlines")}><TabIcon d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 14l2 2 4-4" />Agenda</button>
          <button className="tab-add" aria-label="Ajouter un papier" onClick={() => go("add")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
          <button className="tab" aria-current={tab === "docs" ? "page" : undefined} onClick={() => go("docs")}><TabIcon d="M4 4h10l6 6v10H4zM14 4v6h6M8 13h8M8 17h5" />Papiers</button>
          <button className="tab" aria-current={tab === "budget" ? "page" : undefined} onClick={() => go("budget")}><TabIcon d="M3 20h18M6 16V9M11 16V5M16 16v-7M21 16v-4" />Budget</button>
        </div>
      </nav>
      {reveal && budget && <Reveal budget={budget} onClose={() => setReveal(false)} go={go} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
    </FamilleCtx.Provider>
  );
}

function parseHash(): Route {
  const [s, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { s: s || "home", id };
}
