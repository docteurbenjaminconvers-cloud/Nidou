import type { Activite, BankStatus, BudgetAction, BudgetReport, ChargesReport, Deadline, Doc, FamilleReport, Household, ImportResult, Member } from "./types";
import demoFamille from "./demo/famille.json";
import demoBudget from "./demo/budget.json";
import demoBudgetFamille from "./demo/budget-famille.json";
import demoHousehold from "./demo/household.json";
import demoDocuments from "./demo/documents.json";
import demoDeadlines from "./demo/deadlines.json";
import demoCharges from "./demo/charges.json";
import demoChargesFamille from "./demo/charges-famille.json";

/**
 * Data layer. Talks to the Nidou server under /api. When the server is unreachable (the published
 * demo page, for instance) it switches to an in-memory demo household so every screen stays usable.
 */
export interface Api {
  mode: "serveur" | "demo";
  household(): Promise<Household>;
  setPlan(plan: Household["plan"]): Promise<void>;
  documents(q?: string, category?: string): Promise<Doc[]>;
  document(id: string): Promise<(Doc & { echeances: Deadline[]; texte?: string | null }) | null>;
  addDocument(input: { file?: File; texte?: string; nomFichier?: string }): Promise<Doc & { echeances: Deadline[] }>;
  updateDocument(id: string, patch: Partial<Doc>): Promise<Doc>;
  deleteDocument(id: string): Promise<void>;
  deadlines(): Promise<Deadline[]>;
  setDeadlineDone(id: string, fait: boolean): Promise<void>;
  charges(): Promise<ChargesReport>;
  letter(input: { document_id: string; kind: "resiliation" | "reclamation" | "remboursement"; nom: string; adresse?: string; motif?: string }): Promise<string>;
  budget(): Promise<BudgetReport>;
  importStatement(input: { file?: File; texte?: string; demo?: boolean; compte?: string }): Promise<ImportResult>;
  decide(cle: string, decision: "garde" | "resilie" | "a_faire"): Promise<void>;
  bankStatus(): Promise<BankStatus>;
  bankConnect(email: string): Promise<{ url: string }>;
  bankSync(): Promise<{ comptes: number; lues: number; ajoutees: number }>;
  bankDisconnect(): Promise<void>;
  famille(): Promise<FamilleReport>;
  setSituation(situation: "seul" | "couple" | null): Promise<void>;
  addMember(m: Partial<Member> & { prenom: string }): Promise<Member>;
  updateMember(id: string, patch: Partial<Member>): Promise<Member>;
  deleteMember(id: string): Promise<void>;
  addActivite(a: Partial<Activite> & { titre: string }): Promise<Activite>;
  updateActivite(id: string, patch: Partial<Activite>): Promise<Activite>;
  deleteActivite(id: string): Promise<void>;
  // accounts & shared household
  moi(): Promise<{ user: { id: string; email: string; prenom: string | null } | null; auth: boolean; foyers: { id: string; nom: string; role: string }[] }>;
  demanderLien(email: string): Promise<{ ok: boolean; envoye: boolean; lien: string | null }>;
  deconnexion(): Promise<void>;
  comptes(): Promise<{ comptes: { id: string; email: string; prenom: string | null; role: string; rejoint_le: string }[]; invitations: { token: string; email: string; prenom: string | null; expire_le: string }[] }>;
  inviter(email: string, prenom: string | null): Promise<{ ok: boolean; envoye: boolean; lien: string | null }>;
  annulerInvitation(token: string): Promise<void>;
  retirerCompte(userId: string): Promise<void>;
  regenererMcp(): Promise<string>;
  renommer(nom: string): Promise<void>;
  checkout(formule: "solo" | "duo" | "tribu", periode: "mensuel" | "annuel"): Promise<{ url: string; simule: boolean }>;
  pushCle(): Promise<{ actif: boolean; cle: string | null; appareils: number }>;
  pushAbonner(s: { endpoint: string; keys: { p256dh: string; auth: string }; appareil: string | null }): Promise<void>;
  pushDesabonner(endpoint: string): Promise<void>;
  pushTest(): Promise<{ envoyes: number; actif: boolean }>;
  portail(): Promise<{ url: string }>;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, init);
  if (!r.ok) {
    let body: any = {};
    try { body = await r.json(); } catch {}
    throw new ApiError(r.status, body.error ?? "erreur", body.message ?? `Erreur ${r.status}`);
  }
  return r.json();
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const serverApi: Api = {
  mode: "serveur",
  household: () => call("/household"),
  setPlan: async (plan) => { await call("/household", json({ plan }, "PATCH")); },
  documents: (q, category) => call(`/documents?${new URLSearchParams({ ...(q ? { q } : {}), ...(category ? { category } : {}) })}`),
  document: (id) => call(`/documents/${id}`).catch(() => null) as any,
  addDocument: async ({ file, texte, nomFichier }) => {
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      if (texte) fd.append("texte", texte);
      return call("/documents", { method: "POST", body: fd });
    }
    return call("/documents", json({ texte, nomFichier }));
  },
  updateDocument: (id, patch) => call(`/documents/${id}`, json(patch, "PATCH")),
  deleteDocument: async (id) => { await call(`/documents/${id}`, { method: "DELETE" }); },
  deadlines: () => call("/deadlines"),
  setDeadlineDone: async (id, fait) => { await call(`/deadlines/${id}`, json({ fait }, "PATCH")); },
  charges: () => call("/charges"),
  letter: async (input) => (await call<{ texte: string }>("/letters", json(input))).texte,
  budget: () => call("/budget"),
  importStatement: async ({ file, texte, demo, compte }) => {
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      if (compte) fd.append("compte", compte);
      return call("/transactions/import", { method: "POST", body: fd });
    }
    return call("/transactions/import", json({ texte, demo, compte }));
  },
  decide: async (cle, decision) => { await call("/budget/decision", json({ cle, decision })); },
  bankStatus: () => call("/bank/status"),
  bankConnect: (email) => call("/bank/connect", json({ email })),
  bankSync: () => call("/bank/sync", { method: "POST" }),
  bankDisconnect: async () => { await call("/bank", { method: "DELETE" }); },
  famille: () => call("/famille"),
  setSituation: async (situation) => { await call("/famille", json({ situation }, "PATCH")); },
  addMember: (m) => call("/members", json(m)),
  updateMember: (id, patch) => call(`/members/${id}`, json(patch, "PATCH")),
  deleteMember: async (id) => { await call(`/members/${id}`, { method: "DELETE" }); },
  addActivite: (a) => call("/activites", json(a)),
  updateActivite: (id, patch) => call(`/activites/${id}`, json(patch, "PATCH")),
  deleteActivite: async (id) => { await call(`/activites/${id}`, { method: "DELETE" }); },
  moi: () => call("/auth/moi"),
  demanderLien: (email) => call("/auth/demander", json({ email })),
  deconnexion: async () => { await call("/auth/deconnexion", { method: "POST" }); },
  comptes: () => call("/foyer/comptes"),
  inviter: (email, prenom) => call("/invitations", json({ email, prenom })),
  annulerInvitation: async (token) => { await call(`/invitations/${token}`, { method: "DELETE" }); },
  retirerCompte: async (id) => { await call(`/foyer/comptes/${id}`, { method: "DELETE" }); },
  regenererMcp: async () => (await call<{ token: string }>("/mcp/regenerer", { method: "POST" })).token,
  renommer: async (nom) => { await call("/household", json({ nom }, "PATCH")); },
  checkout: (formule, periode) => call("/abonnement/checkout", json({ formule, periode })),
  pushCle: () => call("/push/cle"),
  pushAbonner: async (s) => { await call("/push/abonner", json(s)); },
  pushDesabonner: async (endpoint) => { await call("/push/abonner", json({ endpoint }, "DELETE")); },
  pushTest: () => call("/push/test", { method: "POST" }),
  portail: () => call("/abonnement/portail", { method: "POST" }),
};

// ---------- demo adapter ----------
function makeDemoApi(): Api {
  const state = {
    household: structuredClone(demoHousehold) as Household,
    docs: structuredClone(demoDocuments) as Doc[],
    deadlines: structuredClone(demoDeadlines) as Deadline[],
    imported: false,
    bank: false,
    decisions: {} as Record<string, string>,
    famille: structuredClone(demoFamille) as unknown as FamilleReport,
    comptes: [{ id: "u1", email: "demo@nidou.fr", prenom: "Moi", role: "proprietaire", rejoint_le: "2026-10-01T09:00:00.000Z" }, { id: "u2", email: "camille@example.org", prenom: "Camille", role: "membre", rejoint_le: "2026-10-02T18:30:00.000Z" }],
    invitations: [] as { token: string; email: string; prenom: string | null; expire_le: string }[],
  };
  const today = () => new Date().toISOString().slice(0, 10);
  return {
    mode: "demo",
    household: async () => ({ ...state.household, documents: state.docs.length, comptes: state.comptes.length }),
    setPlan: async (plan) => {
      state.household.plan = plan;
      // Demo: switching to free simulates the end of the trial (bare free plan: no AI reading, no statement import, no bank).
      if (plan === "gratuit" && state.household.essai) state.household.essai = { ...state.household.essai, jours_restants: 0, actif: false };
      if (plan === "gratuit") { state.household.plan_souscrit = "gratuit"; state.household.capacite_comptes = 1; state.household.abonnement = undefined; }
    },
    documents: async (q, category) =>
      state.docs.filter((d) => (!category || d.category === category) && (!q || [d.title, d.organisme, d.resume].some((v) => v?.toLowerCase().includes(q.toLowerCase())))),
    document: async (id) => {
      const d = state.docs.find((x) => x.id === id);
      return d ? { ...d, echeances: state.deadlines.filter((x) => x.document_id === id) } : null;
    },
    addDocument: async ({ file, texte, nomFichier }) => {
      await new Promise((r) => setTimeout(r, 900));
      const name = nomFichier ?? file?.name ?? "Document";
      const d: Doc = {
        id: crypto.randomUUID(), title: name.replace(/\.[a-z0-9]+$/i, ""), category: "autre", organisme: null, numero_contrat: null,
        montant: (texte ?? "").match(/(\d+[,.]?\d*)\s*€/)?.[1] ? parseFloat((texte ?? "").match(/(\d+[,.]?\d*)\s*€/)![1].replace(",", ".")) : null,
        periodicite: /mois/i.test(texte ?? "") ? "mensuel" : null, date_document: today(), date_debut: null, date_fin: null, preavis_jours: null,
        resume: "Mode démo : l'extraction IA complète fonctionne avec le serveur Nidou.", confiance: 0.3, verifie: 0, member_id: null, cree_le: new Date().toISOString(),
      };
      state.docs.unshift(d);
      return { ...d, echeances: [] };
    },
    updateDocument: async (id, patch) => {
      const d = state.docs.find((x) => x.id === id)!;
      Object.assign(d, patch);
      return d;
    },
    deleteDocument: async (id) => {
      state.docs = state.docs.filter((x) => x.id !== id);
      state.deadlines = state.deadlines.filter((x) => x.document_id !== id);
    },
    deadlines: async () => state.deadlines.filter((d) => !d.fait).sort((a, b) => a.date.localeCompare(b.date)),
    setDeadlineDone: async (id, fait) => { const d = state.deadlines.find((x) => x.id === id); if (d) d.fait = fait ? 1 : 0; },
    charges: async () => (state.household.plan === "famille" ? (demoChargesFamille as ChargesReport) : (demoCharges as ChargesReport)),
    budget: async () => {
      const base = structuredClone(state.household.plan === "famille" ? demoBudgetFamille : demoBudget) as BudgetReport;
      if (!state.imported) return { ...base, nb_transactions: 0, actions: [], actions_total: 0, recurrences: [], par_categorie: [] };
      base.actions = base.actions.map((a) => ({ ...a, decision: (state.decisions[a.cle] as BudgetAction["decision"]) ?? a.decision }));
      base.economies_decidees = base.actions.filter((a) => a.decision === "resilie").reduce((s, a) => s + a.economie_annuelle, 0);
      base.economies_possibles = base.actions.filter((a) => a.decision !== "garde").reduce((s, a) => s + a.economie_annuelle, 0);
      return base;
    },
    importStatement: async () => {
      await new Promise((r) => setTimeout(r, 1200));
      state.imported = true;
      return { lues: 127, ajoutees: 127, doublons: 0 };
    },
    decide: async (cle, decision) => { state.decisions[cle] = decision; },
    bankStatus: async () => ({
      fournisseur: "simule", connecte: state.bank, statut: state.bank ? "connecte" : "aucune", derniere_synchro: state.bank ? new Date().toISOString() : null,
      comptes: state.bank ? [{ id: "sim:1", nom: "Compte joint", banque: "Banque de démonstration", solde: 2487.91, devise: "EUR", maj_le: new Date().toISOString() }] : [],
    }),
    bankConnect: async () => { await new Promise((r) => setTimeout(r, 900)); state.bank = true; state.imported = true; return { url: "" }; },
    bankSync: async () => { await new Promise((r) => setTimeout(r, 700)); return { comptes: 1, lues: 127, ajoutees: 0 }; },
    bankDisconnect: async () => { state.bank = false; },
    // Family: demo state is edited in memory; computed parts (agenda, costs) are recomputed locally.
    famille: async () => recomputeFamille(state.famille, state.household),
    setSituation: async (situation) => { state.famille.situation = situation; state.household.situation = situation; },
    addMember: async (m) => {
      const row = { id: crypto.randomUUID(), role: "adulte" as const, date_naissance: null, etablissement: null, classe: null, cantine_jours: null, cantine_cout_mois: null, notes: null, ...m, age: null, niveau: "inconnu", role_label: "" };
      state.famille.membres.push(row); state.household.membres = state.famille.membres.map(({ id, prenom, role }) => ({ id, prenom, role }));
      return row;
    },
    updateMember: async (id, patch) => { const m = state.famille.membres.find((x) => x.id === id)!; Object.assign(m, patch); return m; },
    deleteMember: async (id) => { state.famille.membres = state.famille.membres.filter((x) => x.id !== id); state.famille.activites = state.famille.activites.filter((a) => a.member_id !== id); },
    addActivite: async (a) => {
      const row: Activite = { id: crypto.randomUUID(), member_id: null, type: "autre", jour: null, heure_debut: null, heure_fin: null, lieu: null, cout_mois: null, date_debut: null, date_fin: null, note: null, ...a };
      state.famille.activites.push(row); return row;
    },
    updateActivite: async (id, patch) => { const a = state.famille.activites.find((x) => x.id === id)!; Object.assign(a, patch); return a; },
    deleteActivite: async (id) => { state.famille.activites = state.famille.activites.filter((x) => x.id !== id); },
    moi: async () => ({ user: { id: "u1", email: "demo@nidou.fr", prenom: "Moi" }, auth: false, foyers: [{ id: state.household.id, nom: state.household.nom, role: "proprietaire" }] }),
    demanderLien: async () => ({ ok: true, envoye: false, lien: null }),
    deconnexion: async () => {},
    comptes: async () => ({ comptes: state.comptes, invitations: state.invitations }),
    inviter: async (email, prenom) => {
      const cap = state.household.capacite_comptes ?? 6;
      if (state.comptes.length + state.invitations.length >= cap) throw new ApiError(402, "limite_comptes", cap === 1 ? "Le plan gratuit est réservé à une personne. Avec Duo, votre conjoint·e se connecte aussi ; avec Tribu, jusqu'à 6 personnes." : `Votre formule accepte ${cap} personnes connectées. Passez à Tribu pour en inviter plus.`); state.invitations.push({ token: crypto.randomUUID(), email, prenom, expire_le: new Date(Date.now() + 7 * 864e5).toISOString() }); return { ok: true, envoye: true, lien: null }; },
    annulerInvitation: async (token) => { state.invitations = state.invitations.filter((i) => i.token !== token); },
    retirerCompte: async (id) => { state.comptes = state.comptes.filter((c) => c.id !== id); },
    regenererMcp: async () => "demo-" + crypto.randomUUID().slice(0, 8),
    renommer: async (nom) => { state.household.nom = nom; },
    checkout: async (formule, periode) => { state.household.plan = "famille"; state.household.plan_souscrit = "famille"; state.household.capacite_comptes = { solo: 1, duo: 2, tribu: 6 }[formule]; state.household.abonnement = { stripe: false, statut: "simule", formule, periode, fin: new Date(Date.now() + (periode === "annuel" ? 365 : 30) * 864e5).toISOString().slice(0, 10), prix: { mensuel: 9.9, annuel: 99 }, gerable: false }; return { url: "", simule: true }; },
    portail: async () => ({ url: "" }),
    pushCle: async () => ({ actif: false, cle: null, appareils: 0 }),
    pushAbonner: async () => {},
    pushDesabonner: async () => {},
    pushTest: async () => ({ envoyes: 0, actif: false }),
    letter: async ({ kind, nom }) => {
      const d = state.docs[0];
      return `${nom}\n\n${d?.organisme ?? "Service client"}\n\nObjet : ${kind === "resiliation" ? "Résiliation" : kind === "reclamation" ? "Réclamation" : "Demande de remboursement"} — ${d?.title ?? ""}\n\nMadame, Monsieur,\n\n(Mode démo : le courrier complet est rédigé par le serveur Nidou.)\n\n${nom}`;
    },
  };
}

/** Demo only: recompute the derived parts of the family report after local edits (the server does this in famille.ts). */
function recomputeFamille(f: FamilleReport, h: Household): FamilleReport {
  const JOUR_IDX: Record<string, number> = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
  const byId = new Map(f.membres.map((m) => [m.id, m]));
  const semaine: FamilleReport["semaine"] = [];
  for (const a of f.activites) if (a.jour) semaine.push({ jour: a.jour, heure_debut: a.heure_debut, heure_fin: a.heure_fin, titre: a.titre, membre: a.member_id ? byId.get(a.member_id)?.prenom ?? null : null, member_id: a.member_id, lieu: a.lieu, type: a.type, activite_id: a.id });
  const cant = new Map<number, typeof f.membres>();
  for (const m of f.membres) for (const j of (m.cantine_jours ?? "").split(",").map((x) => x.trim().slice(0, 3)).filter(Boolean)) if (JOUR_IDX[j]) cant.set(JOUR_IDX[j], [...(cant.get(JOUR_IDX[j]) ?? []), m]);
  for (const [jour, ms] of cant) semaine.push({ jour, heure_debut: "12:00", heure_fin: "13:30", titre: "Cantine", membre: ms.map((m) => m.prenom).join(", "), member_id: ms.length === 1 ? ms[0].id : null, lieu: ms.length === 1 ? ms[0].etablissement ?? null : null, type: "cantine", activite_id: null });
  semaine.sort((x, y) => x.jour - y.jour || (x.heure_debut ?? "").localeCompare(y.heure_debut ?? ""));
  const age = (d?: string | null) => { if (!d) return null; const b = new Date(d), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--; return a; };
  const ROLE: Record<string, string> = { adulte: "Adulte", enfant: "Enfant", parent_a_charge: "Parent à charge", autre_a_charge: "Personne à charge" };
  const membres = f.membres.map((m) => ({ ...m, age: age(m.date_naissance), role_label: ROLE[m.role] ?? m.role }));
  const couts = membres.filter((m) => m.role !== "adulte").map((m) => {
    const lignes = f.activites.filter((a) => a.member_id === m.id && (a.cout_mois ?? 0) > 0).map((a) => ({ titre: a.titre, mensuel: a.cout_mois! }));
    const cantine = m.cantine_cout_mois ?? 0, act = lignes.reduce((s, l) => s + l.mensuel, 0);
    return { member_id: m.id, prenom: m.prenom, cantine, activites: act, total: cantine + act, lignes };
  });
  h.membres = membres.map(({ id, prenom, role }) => ({ id, prenom, role }));
  return { ...f, membres, semaine, couts, cout_enfants_mois: couts.reduce((s, c) => s + c.total, 0), composition: { adultes: membres.filter((m) => m.role === "adulte").length, enfants: membres.filter((m) => m.role === "enfant").length, a_charge: membres.filter((m) => m.role === "parent_a_charge" || m.role === "autre_a_charge").length } };
}

let instance: Api | null = null;

/** Picks the server when /api answers, the demo adapter otherwise. */
export async function getApi(): Promise<Api> {
  if (instance) return instance;
  try {
    const r = await fetch("/api/household", { signal: AbortSignal.timeout(2500) });
    // 200: a server with a session; 401: a server that wants a login (the app shows the login screen).
    if ((r.ok || r.status === 401) && (r.headers.get("content-type") ?? "").includes("json")) { instance = serverApi; return instance; }
  } catch {}
  instance = makeDemoApi();
  return instance;
}

export { ApiError };
