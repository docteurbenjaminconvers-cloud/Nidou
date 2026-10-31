import type { AssistantEtat, AssistantMessage, AssistantReponse } from "./types";
import type { Activite, BankStatus, BudgetAction, BudgetReport, ChargesReport, Deadline, Doc, FamilleReport, Household, ImportResult, Member, Mesure, Temoin, Banque, BanquesReport, Veille, VeillesReport, VuePersonne } from "./types";
import demoFamille from "./demo/famille.json";
import { MODULES, PACKS, SOCLE, SOCLE_INCLUT, droits, normaliser, type Espace, type ModuleId } from "../../server/src/offre";
import { DEMO_BUDGET, grandLivre, rapportBudget, type DonneesBudget, type RapportBudget, type TxB } from "../../server/src/budgetExpert";
import { COMPTE_PRO_DEMO, demoComptePro, demoPro, rapportIndependant, rapportPro, type DonneesPro, type RapportPro } from "../../server/src/viePro";
import { DEMO_LOCATIF, demoLoyers, rapportLocatif, type DonneesLocatif, type RapportLocatif } from "../../server/src/locatif";
import { lireReleveDemo } from "../../server/src/categorie";
import { demoStatement } from "../../server/src/seed-statement";
import { etatDossiers } from "../../server/src/dossiers";
import { grandMenage } from "../../server/src/conservation";
import { scenarios } from "../../server/src/urgence";
import { pointSemaine } from "../../server/src/semaine";
import demoBudget from "./demo/budget.json";
import demoBudgetFamille from "./demo/budget-famille.json";
import demoHousehold from "./demo/household.json";
import demoDocuments from "./demo/documents.json";
import demoDeadlines from "./demo/deadlines.json";
import demoCharges from "./demo/charges.json";
import demoChargesFamille from "./demo/charges-famille.json";

/**
 * Data layer. Talks to the Lucien server under /api. When the server is unreachable (the published
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
  bankConnect(email: string, aspsp?: Banque): Promise<{ url: string }>;
  banques(): Promise<BanquesReport>;
  bankSync(): Promise<{ comptes: number; lues: number; ajoutees: number }>;
  bankDisconnect(): Promise<void>;
  famille(): Promise<FamilleReport>;
  setSituation(situation: "seul" | "couple" | null): Promise<void>;
  addMember(m: Partial<Member> & { prenom: string }): Promise<Member>;
  updateMember(id: string, patch: Partial<Member>): Promise<Member>;
  deleteMember(id: string): Promise<void>;
  setMemberPhoto(id: string, photo: Blob): Promise<Member>;
  deleteMemberPhoto(id: string): Promise<Member>;
  /** Where to load a member's portrait from, or null when there is none. */
  photoUrl(m: Pick<Member, "id" | "photo">): string | null;
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
  assistant(messages: AssistantMessage[]): Promise<AssistantReponse>;
  assistantOption(actif: boolean): Promise<AssistantEtat>;
  renommer(nom: string): Promise<void>;
  setHebdo(actif: boolean): Promise<void>;
  /** The offer (socle, modules, packs) and the household's modules. */
  offre(): Promise<OffreEtat>;
  choisirModules(modules: ModuleId[], pack: string | null, opts?: { formule: "solo" | "duo" | "tribu"; periode: "mensuel" | "annuel"; biens?: number; proches?: number }): Promise<{ souscrits: ModuleId[]; actifs: ModuleId[]; url?: string }>;
  /** A paid space: its stored data, the report computed on the household's operations, and the bank accounts seen. */
  espace<E extends Espace>(e: E): Promise<EspaceReponse<E>>;
  sauverEspace<E extends Espace>(e: E, donnees: EspaceDonnees[E]): Promise<void>;
  grandLivre(): Promise<string>;
  partagesPro(): Promise<PartageComptable[]>;
  creerPartagePro(member_id: string | null, nom: string | null): Promise<PartageComptable>;
  revoquerPartagePro(token: string): Promise<void>;
  /** Public page of the accountant (secret link, no session). */
  vueComptable(token: string): Promise<VueComptable>;
  agendaLien(): Promise<{ url: string }>;
  agendaLienNouveau(): Promise<{ url: string }>;
  checkout(formule: "solo" | "duo" | "tribu", periode: "mensuel" | "annuel"): Promise<{ url: string; simule: boolean }>;
  pushCle(): Promise<{ actif: boolean; cle: string | null; appareils: number }>;
  pushAbonner(s: { endpoint: string; keys: { p256dh: string; auth: string }; appareil: string | null }): Promise<void>;
  pushDesabonner(endpoint: string): Promise<void>;
  pushTest(): Promise<{ envoyes: number; actif: boolean }>;
  portail(): Promise<{ url: string }>;
  // protected-person bank watch
  veilles(): Promise<VeillesReport>;
  creerVeille(input: { member_id: string; mesure: Mesure; acte_document_id: string | null; aidant_qualite: string | null; temoins: Temoin[]; personne_peut_consentir: boolean }): Promise<Veille>;
  veille(id: string): Promise<Veille>;
  veilleVue(id: string): Promise<void>;
  terminerVeille(id: string, motif: "deces" | "fin_mesure" | "demande_aidant"): Promise<Veille>;
  journalVeille(id: string): Promise<{ verification: { intact: boolean; lignes: number; rupture: number | null }; lignes: { quand: string; acteur: string; action: string; details: string; empreinte: string }[] }>;
  journalCsvUrl(id: string): string | null;
  acheterVeille(periode: "mensuel" | "annuel"): Promise<void>;
  // the protected person's own page (no account)
  vuePersonne(jeton: string): Promise<VuePersonne>;
  consentirVeille(jeton: string, input: { nom_signataire: string; en_qualite_de: "personne" | "representant"; accepte: boolean }): Promise<VuePersonne>;
  retirerVeille(jeton: string, nom: string): Promise<VuePersonne>;
  banquesVeille(jeton: string): Promise<BanquesReport>;
  banqueVeille(jeton: string, aspsp?: Banque): Promise<{ url: string | null } & Partial<VuePersonne>>;
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
  bankConnect: (email, aspsp) => call("/bank/connect", json(aspsp ? { aspsp } : { email })),
  banques: () => call("/bank/banques"),
  bankSync: () => call("/bank/sync", { method: "POST" }),
  bankDisconnect: async () => { await call("/bank", { method: "DELETE" }); },
  famille: () => call("/famille"),
  setSituation: async (situation) => { await call("/famille", json({ situation }, "PATCH")); },
  addMember: (m) => call("/members", json(m)),
  updateMember: (id, patch) => call(`/members/${id}`, json(patch, "PATCH")),
  deleteMember: async (id) => { await call(`/members/${id}`, { method: "DELETE" }); },
  setMemberPhoto: (id, photo) => call(`/members/${id}/photo`, { method: "PUT", body: photo, headers: { "content-type": photo.type || "image/jpeg" } }),
  deleteMemberPhoto: (id) => call(`/members/${id}/photo`, { method: "DELETE" }),
  photoUrl: (m) => (m.photo ? `/api/members/${m.id}/photo?v=${encodeURIComponent(m.photo)}` : null),
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
  assistant: (messages) => call("/assistant", json({ messages })),
  assistantOption: async (actif) => (await call<{ etat: AssistantEtat }>("/abonnement/assistant", json({ actif }))).etat,
  renommer: async (nom) => { await call("/household", json({ nom }, "PATCH")); },
  setHebdo: async (hebdo) => { await call("/household", json({ hebdo }, "PATCH")); },
  offre: () => call("/offre"),
  choisirModules: (modules, pack, opts) => call("/offre/modules", json({ modules, pack, ...opts })),
  espace: (e) => call(`/espaces/${e}`),
  sauverEspace: async (e, donnees) => { await call(`/espaces/${e}`, json(donnees, "PUT")); },
  partagesPro: () => call("/espaces/pro/partages"),
  creerPartagePro: (member_id, nom) => call("/espaces/pro/partages", json({ member_id, nom })),
  revoquerPartagePro: async (token) => { await call(`/espaces/pro/partages/${token}`, { method: "DELETE" }); },
  vueComptable: (token) => call(`/comptable/${token}`),
  grandLivre: async () => { const r = await fetch("/api/espaces/budget/grand-livre.csv"); if (!r.ok) throw new ApiError(r.status, "erreur", "Export impossible"); return r.text(); },
  agendaLien: () => call("/agenda-lien"),
  agendaLienNouveau: () => call("/agenda-lien", { method: "POST" }),
  checkout: (formule, periode) => call("/abonnement/checkout", json({ formule, periode })),
  pushCle: () => call("/push/cle"),
  pushAbonner: async (s) => { await call("/push/abonner", json(s)); },
  pushDesabonner: async (endpoint) => { await call("/push/abonner", json({ endpoint }, "DELETE")); },
  pushTest: () => call("/push/test", { method: "POST" }),
  portail: () => call("/abonnement/portail", { method: "POST" }),
  veilles: () => call("/veilles"),
  creerVeille: (input) => call("/veilles", json(input)),
  veille: (id) => call(`/veilles/${id}`),
  veilleVue: async (id) => { await call(`/veilles/${id}/vue`, { method: "POST" }); },
  terminerVeille: (id, motif) => call(`/veilles/${id}/terminer`, json({ motif })),
  journalVeille: (id) => call(`/veilles/${id}/journal`),
  journalCsvUrl: (id) => `/api/veilles/${id}/journal?format=csv`,
  acheterVeille: async (periode) => { await call("/abonnement/veille", json({ periode })); },
  vuePersonne: (jeton) => call(`/veille/p/${jeton}`),
  consentirVeille: (jeton, input) => call(`/veille/p/${jeton}/consentir`, json(input)),
  retirerVeille: (jeton, nom) => call(`/veille/p/${jeton}/retirer`, json({ nom })),
  banquesVeille: (jeton) => call(`/veille/p/${jeton}/banques`),
  banqueVeille: (jeton, aspsp) => call(`/veille/p/${jeton}/banque`, json(aspsp ? { aspsp } : {})),
};

// ---------- demo adapter ----------
function makeDemoApi(): Api {
  const state = {
    household: structuredClone(demoHousehold) as Household,
    // Papers whose date must stay recent in the demo (payslips, tax notice): dated from today.
    docs: (structuredClone(demoDocuments) as (Doc & { _age_jours?: number })[]).map(({ _age_jours, ...d }) => (_age_jours != null ? { ...d, date_document: new Date(Date.now() - _age_jours * 864e5).toISOString().slice(0, 10) } : d)) as Doc[],
    deadlines: structuredClone(demoDeadlines) as Deadline[],
    imported: false,
    bank: false,
    decisions: {} as Record<string, string>,
    famille: structuredClone(demoFamille) as unknown as FamilleReport,
    comptes: [{ id: "u1", email: "demo@monlucien.fr", prenom: "Moi", role: "proprietaire", rejoint_le: "2026-10-01T09:00:00.000Z" }, { id: "u2", email: "camille@example.org", prenom: "Camille", role: "membre", rejoint_le: "2026-10-02T18:30:00.000Z" }],
    invitations: [] as { token: string; email: string; prenom: string | null; expire_le: string }[],
    veilles: [] as (Veille & { jeton: string; historique: { quand: string; acteur: string; action: string; details: string; empreinte: string }[] })[],
    veillesSupp: 0,
    assistantOption: false,
    assistantQuestions: 0,
  };
  // Demo of the watch: same rules as the server, on a fictional statement (pension, then a scam unfolding).
  const veilleDemo = makeVeilleDemo(state, () => state.household, () => state.famille.membres);
  const today = () => new Date().toISOString().slice(0, 10);
  return {
    mode: "demo",
    household: async () => ({ ...state.household, documents: state.docs.length, comptes: state.comptes.length, assistant: assistantEtatDemo(state) }),
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
        resume: "Mode démo : l'extraction IA complète fonctionne avec le serveur Lucien.", confiance: 0.3, verifie: 0, member_id: null, cree_le: new Date().toISOString(),
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
    banques: async () => ({ fournisseur: "simule", banques: [] }),
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
    setMemberPhoto: async (id, photo) => { const m = state.famille.membres.find((x) => x.id === id)!; m.photo = URL.createObjectURL(photo); return m; },
    deleteMemberPhoto: async (id) => { const m = state.famille.membres.find((x) => x.id === id)!; m.photo = null; return m; },
    // Demo portraits are illustrations shipped with the app; a photo picked in the demo stays in the browser (blob:).
    photoUrl: (m) => (!m.photo ? null : /^(blob:|data:)/.test(m.photo) ? m.photo : `demo/${m.photo}`),
    deleteMember: async (id) => { state.famille.membres = state.famille.membres.filter((x) => x.id !== id); state.famille.activites = state.famille.activites.filter((a) => a.member_id !== id); },
    addActivite: async (a) => {
      const row: Activite = { id: crypto.randomUUID(), member_id: null, type: "autre", jour: null, heure_debut: null, heure_fin: null, lieu: null, cout_mois: null, date_debut: null, date_fin: null, note: null, ...a };
      state.famille.activites.push(row); return row;
    },
    updateActivite: async (id, patch) => { const a = state.famille.activites.find((x) => x.id === id)!; Object.assign(a, patch); return a; },
    deleteActivite: async (id) => { state.famille.activites = state.famille.activites.filter((x) => x.id !== id); },
    moi: async () => ({ user: { id: "u1", email: "demo@monlucien.fr", prenom: "Moi" }, auth: false, foyers: [{ id: state.household.id, nom: state.household.nom, role: "proprietaire" }] }),
    demanderLien: async () => ({ ok: true, envoye: false, lien: null }),
    deconnexion: async () => {},
    comptes: async () => ({ comptes: state.comptes, invitations: state.invitations }),
    inviter: async (email, prenom) => {
      const cap = state.household.capacite_comptes ?? 6;
      if (state.comptes.length + state.invitations.length >= cap) throw new ApiError(402, "limite_comptes", cap === 1 ? "Le plan gratuit est réservé à une personne. Avec Duo, votre conjoint·e se connecte aussi ; avec Tribu, jusqu'à 6 personnes." : `Votre formule accepte ${cap} personnes connectées. Passez à Tribu pour en inviter plus.`); state.invitations.push({ token: crypto.randomUUID(), email, prenom, expire_le: new Date(Date.now() + 7 * 864e5).toISOString() }); return { ok: true, envoye: true, lien: null }; },
    annulerInvitation: async (token) => { state.invitations = state.invitations.filter((i) => i.token !== token); },
    retirerCompte: async (id) => { state.comptes = state.comptes.filter((c) => c.id !== id); },
    regenererMcp: async () => "demo-" + crypto.randomUUID().slice(0, 8),
    assistant: async (messages) => {
      const e = assistantEtatDemo(state);
      if (e.acces === "aucun") throw new ApiError(402, "acces", "L'assistant Lucien est une option à 2,90 € par mois, en plus d'une formule.");
      if (e.restantes <= 0) throw new ApiError(429, "quota", "Les questions offertes pendant la démo sont épuisées.");
      await new Promise((r) => setTimeout(r, 900));
      state.assistantQuestions++;
      return { ...assistantDemo(messages.at(-1)?.content ?? "", state.docs, state.deadlines, demoChargesFamille as ChargesReport, state.famille, state.household), etat: assistantEtatDemo(state) };
    },
    assistantOption: async (actif) => { state.assistantOption = actif; return assistantEtatDemo(state); },
    renommer: async (nom) => { state.household.nom = nom; },
    setHebdo: async (hebdo) => { state.household.hebdo = hebdo; },
    ...makeEspacesDemo(state),
    agendaLien: async () => ({ url: "" }),
    agendaLienNouveau: async () => ({ url: "" }),
    checkout: async (formule, periode) => { state.household.plan = "famille"; state.household.plan_souscrit = "famille"; state.household.capacite_comptes = { solo: 1, duo: 2, tribu: 6 }[formule]; state.household.abonnement = { stripe: false, statut: "simule", formule, periode, fin: new Date(Date.now() + (periode === "annuel" ? 365 : 30) * 864e5).toISOString().slice(0, 10), prix: { mensuel: 9.9, annuel: 99 }, gerable: false }; return { url: "", simule: true }; },
    portail: async () => ({ url: "" }),
    pushCle: async () => ({ actif: false, cle: null, appareils: 0 }),
    pushAbonner: async () => {},
    pushDesabonner: async () => {},
    pushTest: async () => ({ envoyes: 0, actif: false }),
    ...veilleDemo,
    letter: async ({ kind, nom }) => {
      const d = state.docs[0];
      return `${nom}\n\n${d?.organisme ?? "Service client"}\n\nObjet : ${kind === "resiliation" ? "Résiliation" : kind === "reclamation" ? "Réclamation" : "Demande de remboursement"} — ${d?.title ?? ""}\n\nMadame, Monsieur,\n\n(Mode démo : le courrier complet est rédigé par le serveur Lucien.)\n\n${nom}`;
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

type VeilleDemoState = { veilles: (Veille & { jeton: string; historique: { quand: string; acteur: string; action: string; details: string; empreinte: string }[] })[]; veillesSupp: number };
type VeilleApi = Pick<Api, "veilles" | "creerVeille" | "veille" | "veilleVue" | "terminerVeille" | "journalVeille" | "journalCsvUrl" | "acheterVeille" | "vuePersonne" | "consentirVeille" | "retirerVeille" | "banqueVeille" | "banquesVeille">;

function makeVeilleDemo(state: VeilleDemoState, household: () => Household, membres: () => Member[]): VeilleApi {
  const MESURE: Record<Mesure, string> = { aucune: "sans mesure de protection", curatelle: "curatelle", tutelle: "tutelle", habilitation_familiale: "habilitation familiale", mandat_protection_future: "mandat de protection future" };
  const qui = (v: Veille) => v.mesure === "aucune" ? { personne: true, representant: false, texte: `${v.prenom} donne son accord elle-même.` }
    : v.mesure === "curatelle" ? { personne: true, representant: true, texte: `${v.prenom} donne son accord, avec son curateur ou sa curatrice (${v.aidant}).` }
    : { personne: false, representant: true, texte: `${v.aidant}, ${MESURE[v.mesure]}, autorise la veille ; ${v.prenom} en est informée.` };
  let h = 0;
  const log = (v: VeilleDemoState["veilles"][number], acteur: string, action: string, details: object = {}) => { h = (h * 31 + action.length + acteur.length + v.historique.length) >>> 0; v.historique.push({ quand: new Date().toISOString(), acteur, action, details: JSON.stringify(details), empreinte: h.toString(16).padStart(8, "0") + "…" }); };
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
  const ALERTES = (): Veille["alertes"] => [
    { id: "a1", type: "virement_nouveau", gravite: "urgente", titre: "Virement de 2 400 € vers un bénéficiaire inconnu", detail: "VIR SEPA VERS M DUBOIS ALEXANDRE : jamais vu sur ce compte. En cas de doute, appelez la banque pour le bloquer, puis parlez-en avec elle.", quand: d(1), vue: 0 },
    { id: "a2", type: "coupon", gravite: "urgente", titre: "Achat de coupon prépayé (Transcash) de 500 €", detail: "Les escrocs demandent souvent d'acheter des coupons et de leur lire le code au téléphone. Aucun service officiel ne paie par coupon.", quand: d(2), vue: 0 },
    { id: "a3", type: "retraits", gravite: "attention", titre: "3 retraits en 5 jours (700 €)", detail: "Inhabituel par rapport aux deux mois précédents.", quand: d(3), vue: 0 },
    { id: "a4", type: "prelevement_nouveau", gravite: "attention", titre: "2 nouveaux prélèvements : ASSUR OBSEQUES DIRECT, TELESURVEILLANCE PLUS", detail: "Souscrits récemment ? Le démarchage à domicile ou au téléphone ouvre 14 jours pour se rétracter.", quand: d(12), vue: 0 },
  ];
  const find = (id: string) => { const v = state.veilles.find((x) => x.id === id); if (!v) throw new ApiError(404, "introuvable", "Veille introuvable"); return v; };
  const parJeton = (j: string) => { const v = state.veilles.find((x) => x.jeton === j); if (!v) throw new ApiError(404, "introuvable", "Ce lien n'est plus valable."); return v; };
  const capacite = () => { const hh = household(); const f = hh.abonnement?.formule ?? (hh.essai?.actif ? "tribu" : null); return hh.plan === "gratuit" ? 0 : (f === "tribu" ? 1 : 0) + state.veillesSupp; };
  const enCours = () => state.veilles.filter((v) => v.statut !== "terminee").length;
  const pub = (v: Veille): Veille => { const { jeton: _j, historique: _l, ...rest } = v as VeilleDemoState["veilles"][number]; return { ...rest, qui_consent: qui(v) }; };
  const vue = (v: VeilleDemoState["veilles"][number]): VuePersonne => ({
    prenom: v.prenom, nid: household().nom, aidant: v.aidant, aidant_qualite: v.aidant_qualite, mesure: v.mesure, mesure_label: v.mesure_label, statut: v.statut,
    qui_consent: qui(v), accords_donnes: v.accords, consentement_le: v.consentement_le, consentement_expire: v.consentement_expire, temoins: v.temoins, banque_connectee: v.banque_connectee,
    acces: [{ nom: v.aidant, role: v.aidant_qualite ?? "aidant" }, ...v.temoins.map((t) => ({ nom: t.nom, role: "témoin, reçoit les mêmes alertes" }))],
    engagements: [
      "Lucien ne voit vos opérations qu'en lecture : personne ne peut faire de virement ni rien modifier sur votre compte.",
      "Vous n'avez jamais à donner votre code bancaire à quelqu'un d'autre ; vous vous connectez vous-même à votre banque.",
      "Vous voyez ici qui reçoit les alertes. Chaque consultation est notée dans un journal que l'on ne peut pas modifier.",
      "Votre accord vaut un an. Vous pouvez le retirer à tout moment, seul·e, depuis cette page.",
    ],
    derniers_acces: v.historique.filter((l) => l.action === "consultation").slice(-5).map((l) => ({ quand: l.quand, qui: l.acteur })),
  });
  return {
    veilles: async () => ({ ouverte: true, capacite: capacite(), en_cours: enCours(), prix: { mensuel: 3.9, annuel: 39 }, veilles: state.veilles.map(pub) }),
    creerVeille: async (input) => {
      const m = membres().find((x) => x.id === input.member_id);
      if (!m) throw new ApiError(400, "membre", "Personne introuvable.");
      if (state.veilles.some((v) => v.member_id === m.id && v.statut !== "terminee")) throw new ApiError(400, "doublon", `Une veille existe déjà pour ${m.prenom}.`);
      if (input.mesure === "aucune" && !input.personne_peut_consentir) throw new ApiError(400, "consentement_impossible", `Sans mesure de protection, ${m.prenom} doit pouvoir donner son accord elle-même. Si ce n'est plus possible, une mesure doit être demandée au juge des contentieux de la protection : tutelle, curatelle ou habilitation familiale. Lucien ne peut pas l'activer à sa place.`);
      if (input.mesure !== "aucune" && !input.acte_document_id) throw new ApiError(400, "acte_manquant", "Joignez le jugement ou le mandat (ajoutez-le dans Papiers, puis choisissez-le ici).");
      if (input.mesure !== "aucune" && !input.aidant_qualite?.trim()) throw new ApiError(400, "qualite", "Précisez votre qualité dans la mesure (tuteur, curateur, personne habilitée, mandataire).");
      if (enCours() >= capacite()) throw new ApiError(402, "veille_payante", household().plan === "gratuit" ? "La veille bancaire d'un proche demande une formule payante." : "La veille d'un proche coûte 3,90 € par mois (39 € par an) ; la formule Tribu en comprend une.");
      const v = { id: crypto.randomUUID(), jeton: crypto.randomUUID().replace(/-/g, ""), member_id: m.id, prenom: m.prenom, statut: "attente_consentement" as const, mesure: input.mesure, mesure_label: MESURE[input.mesure],
        aidant: "Moi (demo@monlucien.fr)", aidant_qualite: input.aidant_qualite, temoins: input.temoins.filter((t) => t.nom.trim()), consentement_le: null, consentement_expire: null, accords: [], qui_consent: null,
        banque_connectee: false, alertes_non_vues: 0, alertes_urgentes: 0, lien_personne: "", fin_le: null, motif_fin: null, historique: [] };
      v.lien_personne = `${location.origin}${location.pathname}#/consentement/${v.jeton}`;
      log(v, v.aidant, "demande", { personne: m.prenom, mesure: v.mesure });
      state.veilles.unshift(v); return pub(v);
    },
    veille: async (id) => {
      const v = find(id);
      if (v.statut === "active") log(v, v.aidant, "consultation");
      return { ...pub(v), alertes: v.statut === "active" || v.statut === "suspendue" ? v.alertes ?? [] : [], journal: { intact: true, lignes: v.historique.length, rupture: null } };
    },
    veilleVue: async (id) => { const v = find(id); v.alertes = (v.alertes ?? []).map((a) => ({ ...a, vue: 1 })); v.alertes_non_vues = 0; v.alertes_urgentes = 0; },
    terminerVeille: async (id, motif) => { const v = find(id); v.statut = "terminee"; v.fin_le = new Date().toISOString(); v.motif_fin = motif; v.banque_connectee = false; v.lien_personne = null; log(v, v.aidant, "fin", { motif }); return pub(v); },
    journalVeille: async (id) => { const v = find(id); return { verification: { intact: true, lignes: v.historique.length, rupture: null }, lignes: v.historique }; },
    journalCsvUrl: () => null,
    acheterVeille: async () => { state.veillesSupp++; },
    vuePersonne: async (j) => vue(parJeton(j)),
    consentirVeille: async (j, input) => {
      const v = parJeton(j);
      if (!input.accepte || input.nom_signataire.trim().length < 2) throw new ApiError(400, "signature", "Écrivez votre nom et cochez la case pour donner votre accord.");
      const q = qui(v);
      if (input.en_qualite_de === "personne" && !q.personne) throw new ApiError(400, "qualite", "Sous cette mesure, c'est le représentant désigné qui autorise.");
      v.accords = Array.from(new Set([...v.accords, input.en_qualite_de]));
      if ((!q.personne || v.accords.includes("personne")) && (!q.representant || v.accords.includes("representant"))) {
        v.statut = "active"; v.consentement_le = new Date().toISOString(); v.consentement_expire = new Date(Date.now() + 365 * 864e5).toISOString();
      }
      log(v, input.nom_signataire.trim(), "consentement", { en_qualite_de: input.en_qualite_de });
      return vue(v);
    },
    retirerVeille: async (j, nom) => { const v = parJeton(j); v.statut = "terminee"; v.fin_le = new Date().toISOString(); v.motif_fin = "retrait_consentement"; v.banque_connectee = false; log(v, nom || "La personne protégée", "fin", { motif: "retrait_consentement" }); return vue(v); },
    banquesVeille: async () => ({ fournisseur: "simule", banques: [] }),
    banqueVeille: async (j) => {
      const v = parJeton(j);
      if (v.statut !== "active") throw new ApiError(400, "consentement", "La banque se connecte une fois l'accord donné.");
      await new Promise((r) => setTimeout(r, 900));
      v.banque_connectee = true; v.alertes = ALERTES(); v.alertes_non_vues = 4; v.alertes_urgentes = 2;
      log(v, "Banque", "connexion_banque", { fournisseur: "démo" });
      return { url: null, ...vue(v) };
    },
  };
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


// ---------- assistant, demo: the same answers the server gives, scripted on the demo household ----------
function assistantEtatDemo(state: { household: Household; assistantOption: boolean; assistantQuestions: number }): AssistantEtat {
  const enEssai = Boolean(state.household.essai?.actif) && state.household.plan_souscrit !== "famille";
  const acces = state.household.plan === "famille" && state.assistantOption ? "option" : enEssai || state.household.plan === "famille" ? "essai" : "aucun";
  const quota = acces === "option" ? 300 : acces === "essai" ? 20 : 0;
  return { disponible: true, acces, quota, utilisees: state.assistantQuestions, restantes: Math.max(0, quota - state.assistantQuestions), en_pause: false, prix: { mensuel: 2.9, annuel: 29 }, option: state.assistantOption };
}

function assistantDemo(q: string, docs: Doc[], deadlines: Deadline[], charges: ChargesReport, famille?: FamilleReport, household?: Household): Omit<AssistantReponse, "etat"> {
  const t = q.toLowerCase();
  const euro = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
  const date = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
  const doc = (re: RegExp) => docs.find((d) => re.test(`${d.title} ${d.organisme ?? ""}`));
  const assuranceAuto = docs.find((d) => d.category === "assurance" && /auto|peugeot|v[ée]hicule/i.test(d.title));
  const lien = (d?: Doc) => (d ? [{ type: "doc" as const, id: d.id, titre: d.title }] : []);
  if (/r[ée]sili|lettre|courrier/.test(t)) {
    const d = /auto|voiture|maif/.test(t) ? assuranceAuto : docs.find((x) => x.organisme && t.includes(x.organisme.toLowerCase())) ?? assuranceAuto;
    if (d) {
      const texte = `[Votre nom]\n[Votre adresse]\n\n${d.organisme ?? "Service client"}\n\nLe ${date(new Date().toISOString().slice(0, 10))}\n\nRéférence : contrat n° ${d.numero_contrat ?? "[numéro]"}\nObjet : Résiliation de mon contrat — ${d.title}\n\nMadame, Monsieur,\n\nPar la présente, je vous informe de ma décision de résilier le contrat référencé ci-dessus.\n\nJe vous remercie de prendre en compte cette résiliation à la date la plus proche possible et de m'adresser une confirmation écrite précisant la date effective de fin de contrat.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n[Votre nom]`;
      const auto = d.category === "assurance" && /auto|peugeot/i.test(d.title);
      return {
        reponse: auto
          ? `J'ai préparé le courrier pour ${d.title} (${d.organisme}). Le préavis de l'échéance annuelle est dépassé, mais après un an de contrat la loi Hamon permet de résilier à tout moment. Pour une assurance auto, le plus simple est de souscrire ailleurs : le nouvel assureur envoie lui-même la résiliation. Complétez nom et adresse avant l'envoi.`
          : `Voici le courrier de résiliation pour ${d.title}. Complétez votre nom et votre adresse, puis envoyez-le en recommandé avec accusé de réception.`,
        liens: lien(d), courrier: { titre: `Résiliation — ${d.title}`, texte },
      };
    }
  }
  if (/comment|o[ùu] (est|sont|trouve|je)|ajout|scann|photo|invit|conjoint|notification|prix|combien co[ûu]te|formule|abonnement/.test(t) && !/r[ée]sili/.test(t)) {
    const ecran = (id: string, titre: string) => [{ type: "ecran" as const, id, titre }];
    if (/ajout|scann|photo|papier|document/.test(t)) return { reponse: "Touchez le bouton + au centre de la barre du bas, puis prenez le papier en photo ou choisissez un PDF. Lucien le lit, remplit les champs et crée les rappels : vérifiez-les et enregistrez. Astuce : vous pouvez aussi transférer vos emails à votre adresse Lucien (Réglages, « Papiers par email »).", liens: ecran("add", "Ajouter un papier"), courrier: null };
    if (/invit|conjoint/.test(t)) return { reponse: "Dans Réglages, rubrique « Famille partagée », saisissez l'email de votre conjoint : il reçoit un lien et voit les mêmes papiers et rappels. La formule Duo couvre 2 personnes connectées, Tribu jusqu'à 6.", liens: ecran("settings", "Réglages"), courrier: null };
    if (/notification/.test(t)) return { reponse: "Ouvrez la cloche en haut de l'accueil, puis activez les notifications en bas de l'écran : Lucien vous prévient avant chaque échéance et dès qu'une économie est repérée.", liens: ecran("notifs", "Notifications"), courrier: null };
    return { reponse: "Gratuit pour 1 personne. Solo 6,90 € par mois, Duo 9,90 € (2 personnes), Tribu 13,90 € (jusqu'à 6), ou 10 fois le prix mensuel à l'année. Tout est compris dans chaque formule ; l'assistant est une option à 2,90 € par mois. Sans engagement.", liens: ecran("settings", "Réglages"), courrier: null };
  }
  const ecranLien = (id: string, titre: string) => [{ type: "ecran" as const, id, titre }];
  if (/perdu|vol[ée]?\b|portefeuille|sac\b|d[ée]g[âa]t|fuite|cambriol|accident|h[ôo]pital|urgence/.test(t)) {
    const s = scenarios(docs).find((x) => (/d[ée]g[âa]t|fuite|cambriol/.test(t) ? x.cle === "degat_eaux" : /accident/.test(t) ? x.cle === "accident" : /h[ôo]pital/.test(t) ? x.cle === "hopital" : x.cle === "portefeuille"))!;
    return { reponse: `${s.titre} : voici l'ordre.\n${s.etapes.slice(0, 4).map((e, i) => `${i + 1}. ${e.titre}${e.delai ? ` (${e.delai})` : ""}${e.tel ? `, au ${e.tel.replace(/(\d)(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}` : ""}`).join("\n")}${s.references.length ? `\nVos références : ${s.references.slice(0, 2).map((r) => `${r.titre}${r.numero ? ` (n° ${r.numero})` : ""}`).join(", ")}.` : ""}`, liens: ecranLien("urgence", "En cas de coup dur"), courrier: null };
  }
  if (/dossier|louer|location|appartement|caf\b|pr[êe]t immo|inscri/.test(t)) {
    const cle = /caf\b/.test(t) ? "caf" : /pr[êe]t/.test(t) ? "pret" : /inscri|[ée]cole|cantine/.test(t) ? "ecole" : "location";
    const e = etatDossiers(docs).find((k) => k.cle === cle)!;
    const manque = e.pieces.filter((p) => p.statut !== "ok" && !p.optionnelle);
    return { reponse: `${e.titre} : ${e.prets} pièce${e.prets > 1 ? "s" : ""} sur ${e.requis} prête${e.prets > 1 ? "s" : ""}.${manque.length ? `\nIl manque :\n${manque.map((p) => `• ${p.libelle}${p.statut === "ancien" ? " (celui que j'ai est trop ancien)" : p.statut === "expire" ? " (celui que j'ai est expiré)" : ""}`).join("\n")}` : " Tout y est."}\nDans Dossiers prêts, je prépare le .zip avec le bordereau.`, liens: ecranLien("dossiers", "Dossiers prêts"), courrier: null };
  }
  if (/jeter|garder|m[ée]nage|conserver|trier/.test(t)) {
    const m = grandMenage(docs);
    return { reponse: m.length ? `${m.length} papier${m.length > 1 ? "s peuvent" : " peut"} partir : ${m.map((x) => `${x.doc.title} (${x.etat.garder.toLowerCase()})`).join(", ")}. Le reste est encore utile : chaque papier indique jusqu'à quand le garder.` : "Rien à jeter pour l'instant : chaque papier indique jusqu'à quand le garder.", liens: ecranLien("menage", "Grand ménage"), courrier: null };
  }
  if (/semaine|ce week|dimanche|nous attend/.test(t) && household) {
    const p = pointSemaine({ foyer: household.nom, echeances: deadlines.map((d) => ({ id: d.id, titre: d.titre, date: d.date, fait: d.fait, note: d.note, document_id: d.document_id })), creneaux: famille?.semaine ?? [], aVerifier: 0, economies: null, conseils: famille?.conseils ?? [] });
    return { reponse: `${p.intro}\n${p.sections.filter((s) => s.cle !== "conseil").flatMap((s) => s.items.slice(0, 3).map((i) => `• ${i.titre}${i.detail && s.cle === "agenda" ? ` : ${i.detail}` : ""}`)).join("\n")}`, liens: ecranLien("semaine", "Votre semaine"), courrier: null };
  }
  if (/[ée]conom|budget|cher|payer moins|d[ée]pens/.test(t)) {
    const top = charges.alertes.filter((a) => a.economie_estimee).slice(0, 3);
    const total = top.reduce((s, a) => s + (a.economie_estimee ?? 0), 0);
    return {
      reponse: `Trois pistes rapides, environ ${euro(total)} par an :\n${top.map((a) => `• ${a.titre} : jusqu'à ${euro(a.economie_estimee!)} par an`).join("\n")}\nLe plus simple pour commencer : la box Orange, plus engagée, se renégocie en un appel.`,
      liens: top.flatMap((a) => (a.document_ids.length === 1 ? lien(docs.find((d) => d.id === a.document_ids[0])) : [])),
      courrier: null,
    };
  }
  if (/expir|passeport|carte d'identit|papier d'identit/.test(t)) {
    const d = doc(/passeport/i);
    return { reponse: d ? `Le passeport de Léa expire le ${date(d.date_fin!)}. Les délais en mairie peuvent dépasser deux mois : prenez rendez-vous dès maintenant.` : "Je ne trouve pas de papier d'identité dans vos documents.", liens: lien(d), courrier: null };
  }
  if (/[ée]ch[ée]ance|semaine|mois|bient[ôo]t|à faire|a faire|rappel|quand/.test(t)) {
    const n = deadlines.filter((d) => !d.fait).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    return { reponse: `Les prochaines échéances :\n${n.map((d) => `• ${date(d.date)} : ${d.titre}`).join("\n")}`, liens: n.flatMap((d) => lien(docs.find((x) => x.id === d.document_id))).slice(0, 3), courrier: null };
  }
  if (/assurance|auto|voiture|maif/.test(t)) {
    const d = assuranceAuto;
    return { reponse: d ? `${d.title} chez ${d.organisme}, contrat n° ${d.numero_contrat} : ${euro(d.montant ?? 0)} par an, tous risques, franchise 300 €. Renouvellement le ${date(d.date_fin!)}.` : "Je ne trouve pas d'assurance auto.", liens: lien(d), courrier: null };
  }
  return {
    reponse: "Dans cette démo, je réponds aux questions sur les échéances, les économies, l'assurance auto, les papiers d'identité, le fonctionnement de l'appli, et je prépare des courriers de résiliation. Avec le serveur Lucien, l'assistant lit tous vos papiers.",
    liens: [], courrier: null,
  };
}

// ---------- offre et espaces payants ----------

export type EspaceDonnees = { budget: DonneesBudget; pro: DonneesPro; locatif: DonneesLocatif };
export type EspaceRapport = { budget: RapportBudget; pro: RapportPro; locatif: RapportLocatif };
export interface EspaceReponse<E extends Espace> { donnees: EspaceDonnees[E]; rapport: EspaceRapport[E]; comptes: string[] }
export interface OffreEtat { socle: typeof SOCLE; socle_inclut: string[]; modules: typeof MODULES; packs: typeof PACKS; souscrits: ModuleId[]; actifs: ModuleId[]; paiement: boolean }
export type { Espace, ModuleId };
export interface PartageComptable { token: string; member_id: string | null; nom: string | null; cree_le: string; expire_le: string }
export interface VueComptable { prenom: string; nom_comptable: string | null; expire_le: string; independant: import("../../server/src/viePro").RapportIndependant }

/** Demo: the same pure functions as the server, on the Martin family's fictional accounts. */
function makeEspacesDemo(state: { household: Household; famille: FamilleReport; docs: Doc[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const txs: TxB[] = [...lireReleveDemo(demoStatement(today), "Compte joint"), ...demoComptePro(today), ...demoLoyers(today)];
  const moi = state.famille.membres.find((m) => m.prenom === "Moi")?.id ?? null;
  const camille = state.famille.membres.find((m) => m.prenom === "Camille")?.id ?? null;
  const donnees: EspaceDonnees = { budget: { ...DEMO_BUDGET, comptes_exclus: [COMPTE_PRO_DEMO] }, pro: demoPro({ moi, camille }, today), locatif: structuredClone(DEMO_LOCATIF) };
  let souscrits: ModuleId[] = [];
  let partages: PartageComptable[] = [];
  const actifs = () => [...droits({ plan: state.household.plan, essai_actif: !!state.household.essai?.actif, modules: souscrits })];
  const rapport = <E extends Espace>(e: E): EspaceRapport[E] => (e === "budget" ? rapportBudget(txs, donnees.budget, today) : e === "pro" ? rapportPro(donnees.pro, txs, state.docs, today) : rapportLocatif(donnees.locatif, txs, today)) as EspaceRapport[E];
  return {
    offre: async (): Promise<OffreEtat> => ({ socle: SOCLE, socle_inclut: SOCLE_INCLUT, modules: MODULES, packs: PACKS, souscrits, actifs: actifs(), paiement: true }),
    choisirModules: async (modules: ModuleId[], pack: string | null) => {
      souscrits = normaliser([...(PACKS.find((p) => p.id === pack)?.modules ?? []), ...modules]);
      state.household.plan = "famille";
      return { souscrits, actifs: actifs() };
    },
    espace: async <E extends Espace>(e: E): Promise<EspaceReponse<E>> => ({ donnees: structuredClone(donnees[e]), rapport: rapport(e), comptes: [...new Set(txs.map((t) => t.compte).filter((c): c is string => !!c))] }),
    sauverEspace: async <E extends Espace>(e: E, d: EspaceDonnees[E]) => { (donnees as Record<Espace, unknown>)[e] = structuredClone(d); },
    grandLivre: async () => grandLivre(txs, donnees.budget),
    partagesPro: async () => partages,
    creerPartagePro: async (member_id: string | null, nom: string | null) => { const p = { token: Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join(""), member_id, nom, cree_le: new Date().toISOString(), expire_le: new Date(Date.now() + 365 * 864e5).toISOString() }; partages.unshift(p); return p; },
    revoquerPartagePro: async (token: string) => { partages = partages.filter((x) => x.token !== token); },
    vueComptable: async (token: string) => {
      const p = partages.find((x) => x.token === token);
      const pers = donnees.pro.personnes.find((x) => x.independant && (!p || x.member_id === p.member_id));
      if (!pers?.independant) throw new ApiError(404, "introuvable", "Ce lien n'est plus valable : demandez-en un nouveau à votre client.");
      return { prenom: pers.prenom, nom_comptable: p?.nom ?? "Cabinet Durand (démo)", expire_le: p?.expire_le ?? new Date(Date.now() + 365 * 864e5).toISOString(), independant: rapportIndependant(pers.independant, txs, today) };
    },
  };
}
