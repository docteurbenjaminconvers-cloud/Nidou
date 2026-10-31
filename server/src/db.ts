import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, randomInt } from "node:crypto";

export type DocCategory =
  | "assurance"
  | "energie"
  | "telecom"
  | "logement"
  | "banque"
  | "impots"
  | "abonnement"
  | "sante"
  | "identite"
  | "garantie"
  | "education"
  | "vehicule"
  | "autre";

export type Periodicity = "mensuel" | "trimestriel" | "annuel" | "unique";

export interface DocumentRow {
  id: string;
  household_id: string;
  member_id: string | null;
  title: string;
  category: DocCategory;
  organisme: string | null;
  numero_contrat: string | null;
  montant: number | null;
  periodicite: Periodicity | null;
  date_document: string | null;
  date_debut: string | null;
  date_fin: string | null;
  preavis_jours: number | null;
  resume: string | null;
  texte: string | null;
  fichier: string | null;
  mime: string | null;
  confiance: number | null;
  verifie: number;
  source: string | null;        // app | email
  cree_le: string;
}

export interface DeadlineRow {
  id: string;
  household_id: string;
  document_id: string | null;
  titre: string;
  type: string;
  date: string;
  rappel_jours: number;
  fait: number;
  note: string | null;
}

export interface MemberRow {
  id: string;
  household_id: string;
  prenom: string;
  role: string;                 // adulte | enfant | parent_a_charge | autre_a_charge
  date_naissance: string | null;
  etablissement: string | null; // école, collège, lycée, université…
  classe: string | null;        // "CE2", "4e", "Terminale", "L2 droit"…
  cantine_jours: string | null; // "lun,mar,jeu,ven"
  cantine_cout_mois: number | null;
  notes: string | null;
  photo?: string | null;        // file name of the portrait in the upload dir (a fresh name at each change)
}

export interface ActiviteRow {
  id: string;
  household_id: string;
  member_id: string | null;
  titre: string;
  type: string;                 // sport | musique | art | soutien | garde | sante | autre
  jour: number | null;          // 1 = lundi … 7 = dimanche ; null = ponctuel
  heure_debut: string | null;   // "17:30"
  heure_fin: string | null;
  lieu: string | null;
  cout_mois: number | null;
  date_debut: string | null;
  date_fin: string | null;      // fin de saison → rappel de réinscription
  note: string | null;
}

export interface TransactionRow {
  id: string;
  household_id: string;
  compte: string | null;
  date: string;
  libelle: string;
  marchand: string;
  montant: number;
  categorie: string;
  empreinte: string;
  importe_le: string;
}

export interface BankLinkRow {
  household_id: string;
  fournisseur: string;
  user_uuid: string;
  external_user_id: string;
  derniere_synchro: string | null;
  curseur: string | null;
  statut: "en_attente" | "connecte" | "erreur";
  cree_le: string;
}

export interface BankAccountRow {
  id: string;
  household_id: string;
  item_id: string | null;
  nom: string;
  banque: string | null;
  type: string | null;
  solde: number | null;
  devise: string | null;
  maj_le: string | null;
}

export interface PushSubscriptionRow { id: string; household_id: string; user_id: string | null; endpoint: string; p256dh: string; auth: string; appareil: string | null; cree_le: string }
export interface UserRow { id: string; email: string; prenom: string | null; cree_le: string }
export interface AuthLinkRow { token: string; email: string; household_id: string | null; prenom: string | null; invite_par: string | null; expire_le: string; utilise_le: string | null }

export interface HouseholdRow {
  id: string;
  nom: string;
  plan: "gratuit" | "famille";
  essai_fin: string | null;
  boite_code: string | null;   // suffix of the household's forwarding address (foyer-<code>@in.monlucien.fr)
  situation: string | null;    // seul | couple
  mcp_token: string | null;    // bearer token of this household's MCP connector
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  abonnement_statut: string | null;   // active | trialing | past_due | canceled | unpaid | simule
  abonnement_periode: string | null;  // mensuel | annuel
  formule: string | null;             // solo | duo | tribu
  abonnement_fin: string | null;      // end of the current paid period (ISO date)
  hebdo: number | null;               // 0 = no Sunday « semaine de Lucien » (default: on)
  ics_token: string | null;           // secret of the household's calendar subscription (.ics)
  cree_le: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'gratuit',
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  prenom TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'adulte'
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  prenom TEXT,
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cree_le TEXT NOT NULL,
  expire_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  household_id TEXT REFERENCES households(id),
  prenom TEXT,
  invite_par TEXT,
  expire_le TEXT NOT NULL,
  utilise_le TEXT
);
CREATE TABLE IF NOT EXISTS household_users (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'membre',
  rejoint_le TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  appareil TEXT,
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'autre',
  jour INTEGER,
  heure_debut TEXT,
  heure_fin TEXT,
  lieu TEXT,
  cout_mois REAL,
  date_debut TEXT,
  date_fin TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS famille_faits (
  household_id TEXT NOT NULL REFERENCES households(id),
  cle TEXT NOT NULL,
  quand TEXT NOT NULL,
  PRIMARY KEY (household_id, cle)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id TEXT REFERENCES members(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'autre',
  organisme TEXT,
  numero_contrat TEXT,
  montant REAL,
  periodicite TEXT,
  date_document TEXT,
  date_debut TEXT,
  date_fin TEXT,
  preavis_jours INTEGER,
  resume TEXT,
  texte TEXT,
  fichier TEXT,
  mime TEXT,
  confiance REAL,
  verifie INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  rappel_jours INTEGER NOT NULL DEFAULT 14,
  fait INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS mcp_access_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  outil TEXT NOT NULL,
  arguments TEXT,
  quand TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  compte TEXT,
  date TEXT NOT NULL,
  libelle TEXT NOT NULL,
  marchand TEXT NOT NULL,
  montant REAL NOT NULL,
  categorie TEXT NOT NULL DEFAULT 'autre',
  empreinte TEXT NOT NULL UNIQUE,
  importe_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partages_comptable (
  token TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id TEXT,
  nom TEXT,
  cree_le TEXT NOT NULL,
  expire_le TEXT NOT NULL,
  revoque INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS module_data (
  household_id TEXT NOT NULL REFERENCES households(id),
  espace TEXT NOT NULL,
  donnees TEXT NOT NULL,
  maj_le TEXT NOT NULL,
  PRIMARY KEY (household_id, espace)
);
CREATE TABLE IF NOT EXISTS budget_decisions (
  household_id TEXT NOT NULL REFERENCES households(id),
  cle TEXT NOT NULL,
  decision TEXT NOT NULL,
  quand TEXT NOT NULL,
  PRIMARY KEY (household_id, cle)
);
CREATE TABLE IF NOT EXISTS bank_links (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  fournisseur TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  derniere_synchro TEXT,
  curseur TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  cree_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  item_id TEXT,
  nom TEXT NOT NULL,
  banque TEXT,
  type TEXT,
  solde REAL,
  devise TEXT,
  maj_le TEXT
);
CREATE TABLE IF NOT EXISTS ia_usage (
  household_id TEXT NOT NULL REFERENCES households(id),
  mois TEXT NOT NULL,
  lectures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, mois)
);
CREATE TABLE IF NOT EXISTS ia_depense (
  mois TEXT PRIMARY KEY,
  centimes_gratuit REAL NOT NULL DEFAULT 0,
  centimes_payant REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbox_messages (
  household_id TEXT NOT NULL REFERENCES households(id),
  message_id TEXT NOT NULL,
  expediteur TEXT,
  objet TEXT,
  documents INTEGER NOT NULL DEFAULT 0,
  quand TEXT NOT NULL,
  PRIMARY KEY (household_id, message_id)
);
CREATE TABLE IF NOT EXISTS rappels_envoyes (
  household_id TEXT NOT NULL REFERENCES households(id),
  cle TEXT NOT NULL,
  quand TEXT NOT NULL,
  PRIMARY KEY (household_id, cle)
);
CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  situation TEXT,
  source TEXT,
  cree_le TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_household ON transactions(household_id, date);
CREATE INDEX IF NOT EXISTS idx_docs_household ON documents(household_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_household ON deadlines(household_id, date);
`;

/** URL-safe random token (sessions, magic links, MCP). */
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Short, unambiguous code for the forwarding address (no 0/o/1/l). */
export function newBoiteCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string = process.env.LUCIEN_DB ?? "lucien.sqlite") {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec(SCHEMA);
    // Light migrations for databases created by earlier prototypes.
    const cols = (this.raw.prepare("PRAGMA table_info(households)").all() as unknown as { name: string }[]).map((c) => c.name);
    if (!cols.includes("essai_fin")) this.raw.exec("ALTER TABLE households ADD COLUMN essai_fin TEXT");
    if (!cols.includes("boite_code")) this.raw.exec("ALTER TABLE households ADD COLUMN boite_code TEXT");
    if (!cols.includes("situation")) this.raw.exec("ALTER TABLE households ADD COLUMN situation TEXT");
    if (!cols.includes("mcp_token")) this.raw.exec("ALTER TABLE households ADD COLUMN mcp_token TEXT");
    if (!cols.includes("hebdo")) this.raw.exec("ALTER TABLE households ADD COLUMN hebdo INTEGER DEFAULT 1");
    if (!cols.includes("ics_token")) this.raw.exec("ALTER TABLE households ADD COLUMN ics_token TEXT");
    for (const [col] of [["stripe_customer_id"], ["stripe_subscription_id"], ["abonnement_statut"], ["abonnement_periode"], ["abonnement_fin"], ["formule"], ["modules"]]) {
      if (!cols.includes(col)) this.raw.exec(`ALTER TABLE households ADD COLUMN ${col} TEXT`);
    }
    for (const h of this.raw.prepare("SELECT id FROM households WHERE mcp_token IS NULL").all() as unknown as { id: string }[]) {
      this.raw.prepare("UPDATE households SET mcp_token = ? WHERE id = ?").run(newToken(), h.id);
    }
    const mcols = (this.raw.prepare("PRAGMA table_info(members)").all() as unknown as { name: string }[]).map((c) => c.name);
    for (const [col, type] of [["date_naissance", "TEXT"], ["etablissement", "TEXT"], ["classe", "TEXT"], ["cantine_jours", "TEXT"], ["cantine_cout_mois", "REAL"], ["notes", "TEXT"], ["photo", "TEXT"]]) {
      if (!mcols.includes(col)) this.raw.exec(`ALTER TABLE members ADD COLUMN ${col} ${type}`);
    }
    const dcols = (this.raw.prepare("PRAGMA table_info(documents)").all() as unknown as { name: string }[]).map((c) => c.name);
    if (!dcols.includes("source")) this.raw.exec("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'app'");
    for (const h of this.raw.prepare("SELECT id FROM households WHERE boite_code IS NULL").all() as unknown as { id: string }[]) {
      this.raw.prepare("UPDATE households SET boite_code = ? WHERE id = ?").run(newBoiteCode(), h.id);
    }
  }

  now(): string {
    return new Date().toISOString();
  }

  // ---------- households & members ----------
  /** New households start a reverse trial: full Famille plan for `trialDays`, then back to free. */
  createHousehold(nom: string, trialDays = 15): HouseholdRow {
    const essai_fin = trialDays > 0 ? new Date(Date.now() + trialDays * 864e5).toISOString() : null;
    const row: HouseholdRow = { id: randomUUID(), nom, plan: "gratuit", essai_fin, boite_code: newBoiteCode(), situation: null, mcp_token: newToken(), stripe_customer_id: null, stripe_subscription_id: null, abonnement_statut: null, abonnement_periode: null, abonnement_fin: null, formule: null, hebdo: 1, ics_token: null, cree_le: this.now() };
    this.raw
      .prepare("INSERT INTO households (id, nom, plan, essai_fin, boite_code, mcp_token, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.nom, row.plan, row.essai_fin, row.boite_code, row.mcp_token, row.cree_le);
    return row;
  }

  setAbonnement(id: string, a: Partial<Pick<HouseholdRow, "stripe_customer_id" | "stripe_subscription_id" | "abonnement_statut" | "abonnement_periode" | "abonnement_fin" | "formule" | "plan">>) {
    const keys = Object.keys(a) as (keyof typeof a)[];
    if (!keys.length) return;
    this.raw.prepare(`UPDATE households SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => a[k] as never), id);
  }

  householdByStripeCustomer(customerId: string): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households WHERE stripe_customer_id = ?").get(customerId) as HouseholdRow | undefined;
  }

  householdByMcpToken(token: string): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households WHERE mcp_token = ?").get(token) as HouseholdRow | undefined;
  }

  regenerateMcpToken(id: string): string {
    const t = newToken();
    this.raw.prepare("UPDATE households SET mcp_token = ? WHERE id = ?").run(t, id);
    return t;
  }

  renameHousehold(id: string, nom: string) {
    this.raw.prepare("UPDATE households SET nom = ? WHERE id = ?").run(nom, id);
  }

  // ---------- users, sessions, magic links ----------
  userByEmail(email: string): UserRow | undefined {
    return this.raw.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as UserRow | undefined;
  }

  getUser(id: string): UserRow | undefined {
    return this.raw.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  createUser(email: string, prenom: string | null): UserRow {
    const row: UserRow = { id: randomUUID(), email: email.toLowerCase().trim(), prenom, cree_le: this.now() };
    this.raw.prepare("INSERT INTO users (id, email, prenom, cree_le) VALUES (?, ?, ?, ?)").run(row.id, row.email, row.prenom, row.cree_le);
    return row;
  }

  createAuthLink(email: string, opts: { household_id?: string | null; prenom?: string | null; invite_par?: string | null; ttlMinutes?: number } = {}): string {
    const token = newToken();
    const expire = new Date(Date.now() + (opts.ttlMinutes ?? 30) * 60_000).toISOString();
    this.raw.prepare("INSERT INTO auth_links (token, email, household_id, prenom, invite_par, expire_le) VALUES (?, ?, ?, ?, ?, ?)")
      .run(token, email.toLowerCase().trim(), opts.household_id ?? null, opts.prenom ?? null, opts.invite_par ?? null, expire);
    return token;
  }

  getAuthLink(token: string): AuthLinkRow | undefined {
    return this.raw.prepare("SELECT * FROM auth_links WHERE token = ?").get(token) as AuthLinkRow | undefined;
  }

  useAuthLink(token: string) {
    this.raw.prepare("UPDATE auth_links SET utilise_le = ? WHERE token = ?").run(this.now(), token);
  }

  listInvitations(household_id: string): AuthLinkRow[] {
    return this.raw.prepare("SELECT * FROM auth_links WHERE household_id = ? AND utilise_le IS NULL AND expire_le > ? ORDER BY expire_le").all(household_id, this.now()) as unknown as AuthLinkRow[];
  }

  deleteAuthLink(token: string) {
    this.raw.prepare("DELETE FROM auth_links WHERE token = ?").run(token);
  }

  createSession(user_id: string, ttlDays = 90): string {
    const token = newToken();
    this.raw.prepare("INSERT INTO sessions (token, user_id, cree_le, expire_le) VALUES (?, ?, ?, ?)").run(token, user_id, this.now(), new Date(Date.now() + ttlDays * 864e5).toISOString());
    return token;
  }

  userBySession(token: string): UserRow | undefined {
    const s = this.raw.prepare("SELECT user_id FROM sessions WHERE token = ? AND expire_le > ?").get(token, this.now()) as { user_id: string } | undefined;
    return s ? this.getUser(s.user_id) : undefined;
  }

  deleteSession(token: string) {
    this.raw.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  joinHousehold(household_id: string, user_id: string, role: "proprietaire" | "membre") {
    this.raw.prepare("INSERT OR IGNORE INTO household_users (household_id, user_id, role, rejoint_le) VALUES (?, ?, ?, ?)").run(household_id, user_id, role, this.now());
  }

  leaveHousehold(household_id: string, user_id: string) {
    this.raw.prepare("DELETE FROM household_users WHERE household_id = ? AND user_id = ?").run(household_id, user_id);
  }

  householdsOfUser(user_id: string): (HouseholdRow & { role: string })[] {
    return this.raw.prepare("SELECT h.*, hu.role FROM household_users hu JOIN households h ON h.id = hu.household_id WHERE hu.user_id = ? ORDER BY hu.rejoint_le DESC").all(user_id) as unknown as (HouseholdRow & { role: string })[];
  }

  usersOfHousehold(household_id: string): (UserRow & { role: string; rejoint_le: string })[] {
    return this.raw.prepare("SELECT u.*, hu.role, hu.rejoint_le FROM household_users hu JOIN users u ON u.id = hu.user_id WHERE hu.household_id = ? ORDER BY hu.rejoint_le").all(household_id) as unknown as (UserRow & { role: string; rejoint_le: string })[];
  }

  countUsers(): number {
    return (this.raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  }

  householdByBoiteCode(code: string): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households WHERE boite_code = ?").get(code.toLowerCase()) as HouseholdRow | undefined;
  }

  /** Records an inbound email once; returns false if this message was already processed. */
  recordInboxMessage(household_id: string, message_id: string, expediteur: string | null, objet: string | null, documents: number): boolean {
    const r = this.raw.prepare("INSERT OR IGNORE INTO inbox_messages (household_id, message_id, expediteur, objet, documents, quand) VALUES (?, ?, ?, ?, ?, ?)").run(household_id, message_id, expediteur, objet, documents, this.now());
    return Number(r.changes) > 0;
  }

  listInboxMessages(household_id: string, limit = 20): { message_id: string; expediteur: string | null; objet: string | null; documents: number; quand: string }[] {
    return this.raw.prepare("SELECT message_id, expediteur, objet, documents, quand FROM inbox_messages WHERE household_id = ? ORDER BY quand DESC LIMIT ?").all(household_id, limit) as unknown as { message_id: string; expediteur: string | null; objet: string | null; documents: number; quand: string }[];
  }

  /** The plan that applies today: a paid plan, or Famille while the trial runs, or free. */
  effectivePlan(h: HouseholdRow): "gratuit" | "famille" {
    if (h.plan === "famille") return "famille";
    if (h.essai_fin && h.essai_fin > this.now()) return "famille";
    return "gratuit";
  }

  trialDaysLeft(h: HouseholdRow): number | null {
    if (h.plan === "famille" || !h.essai_fin) return null;
    return Math.max(0, Math.ceil((Date.parse(h.essai_fin) - Date.now()) / 864e5));
  }

  setTrialEnd(id: string, essai_fin: string | null) {
    this.raw.prepare("UPDATE households SET essai_fin = ? WHERE id = ?").run(essai_fin, id);
  }

  getHousehold(id: string): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households WHERE id = ?").get(id) as HouseholdRow | undefined;
  }

  listHouseholds(): HouseholdRow[] {
    return this.raw.prepare("SELECT * FROM households ORDER BY cree_le").all() as unknown as HouseholdRow[];
  }

  /** Records that a one-off reminder was sent; returns false if it already was. */
  marquerRappel(household_id: string, cle: string): boolean {
    const r = this.raw.prepare("INSERT OR IGNORE INTO rappels_envoyes (household_id, cle, quand) VALUES (?, ?, ?)").run(household_id, cle, this.now());
    return Number(r.changes) > 0;
  }

  listRappels(household_id: string): { cle: string; quand: string }[] {
    return this.raw.prepare("SELECT cle, quand FROM rappels_envoyes WHERE household_id = ? ORDER BY quand").all(household_id) as unknown as { cle: string; quand: string }[];
  }

  firstHousehold(): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households ORDER BY cree_le LIMIT 1").get() as HouseholdRow | undefined;
  }

  setPlan(id: string, plan: HouseholdRow["plan"]) {
    this.raw.prepare("UPDATE households SET plan = ? WHERE id = ?").run(plan, id);
  }

  /** Calendar subscription secret, created on first use; `nouveau` revokes the old link. */
  icsToken(id: string, nouveau = false): string {
    const h = this.getHousehold(id)!;
    if (h.ics_token && !nouveau) return h.ics_token;
    const tok = newToken();
    this.raw.prepare("UPDATE households SET ics_token = ? WHERE id = ?").run(tok, id);
    return tok;
  }

  householdByIcsToken(token: string): HouseholdRow | undefined {
    return this.raw.prepare("SELECT * FROM households WHERE ics_token = ?").get(token) as HouseholdRow | undefined;
  }

  /** Paid modules of the household (offre.ts), as a JSON array. */
  getModules(id: string): string[] {
    const r = this.raw.prepare("SELECT modules FROM households WHERE id = ?").get(id) as { modules: string | null } | undefined;
    try { return r?.modules ? JSON.parse(r.modules) : []; } catch { return []; }
  }
  setModules(id: string, modules: string[]) {
    this.raw.prepare("UPDATE households SET modules = ? WHERE id = ?").run(JSON.stringify(modules), id);
  }
  /** Household operations without professional accounts (declared in the budget space): the family budget is not the practice's. */
  transactionsFoyer(household_id: string): TransactionRow[] {
    const exclus = new Set(this.getModuleData<{ comptes_exclus?: string[] }>(household_id, "budget")?.comptes_exclus ?? []);
    return this.listTransactions(household_id).filter((t) => !t.compte || !exclus.has(t.compte));
  }
  /** Read-only links a self-employed member gives to an accountant or approved management association. */
  creerPartage(household_id: string, member_id: string | null, nom: string | null, token: string, jours = 365) {
    const cree = new Date();
    const expire = new Date(cree.getTime() + jours * 864e5);
    this.raw.prepare("INSERT INTO partages_comptable (token, household_id, member_id, nom, cree_le, expire_le) VALUES (?, ?, ?, ?, ?, ?)").run(token, household_id, member_id, nom, cree.toISOString(), expire.toISOString());
    return this.getPartage(token)!;
  }
  getPartage(token: string) {
    return this.raw.prepare("SELECT * FROM partages_comptable WHERE token = ?").get(token) as { token: string; household_id: string; member_id: string | null; nom: string | null; cree_le: string; expire_le: string; revoque: number } | undefined;
  }
  listPartages(household_id: string) {
    return this.raw.prepare("SELECT * FROM partages_comptable WHERE household_id = ? AND revoque = 0 AND expire_le > ? ORDER BY cree_le DESC").all(household_id, new Date().toISOString()) as { token: string; member_id: string | null; nom: string | null; cree_le: string; expire_le: string }[];
  }
  revoquerPartage(household_id: string, token: string) {
    this.raw.prepare("UPDATE partages_comptable SET revoque = 1 WHERE token = ? AND household_id = ?").run(token, household_id);
  }
  getModuleData<T>(household_id: string, espace: string): T | null {
    const r = this.raw.prepare("SELECT donnees FROM module_data WHERE household_id = ? AND espace = ?").get(household_id, espace) as { donnees: string } | undefined;
    return r ? (JSON.parse(r.donnees) as T) : null;
  }
  setModuleData(household_id: string, espace: string, donnees: unknown) {
    this.raw.prepare("INSERT INTO module_data (household_id, espace, donnees, maj_le) VALUES (?, ?, ?, ?) ON CONFLICT(household_id, espace) DO UPDATE SET donnees = excluded.donnees, maj_le = excluded.maj_le")
      .run(household_id, espace, JSON.stringify(donnees), new Date().toISOString());
  }

  setHebdo(id: string, actif: boolean) {
    this.raw.prepare("UPDATE households SET hebdo = ? WHERE id = ?").run(actif ? 1 : 0, id);
  }

  setSituation(id: string, situation: string | null) {
    this.raw.prepare("UPDATE households SET situation = ? WHERE id = ?").run(situation, id);
  }

  addMember(household_id: string, prenom: string, role = "adulte", extra: Partial<MemberRow> = {}): MemberRow {
    const row: MemberRow = {
      id: randomUUID(), household_id, prenom, role,
      date_naissance: extra.date_naissance ?? null, etablissement: extra.etablissement ?? null, classe: extra.classe ?? null,
      cantine_jours: extra.cantine_jours ?? null, cantine_cout_mois: extra.cantine_cout_mois ?? null, notes: extra.notes ?? null,
    };
    this.raw
      .prepare("INSERT INTO members (id, household_id, prenom, role, date_naissance, etablissement, classe, cantine_jours, cantine_cout_mois, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.household_id, row.prenom, row.role, row.date_naissance, row.etablissement, row.classe, row.cantine_jours, row.cantine_cout_mois, row.notes);
    return row;
  }

  updateMember(id: string, patch: Partial<MemberRow>) {
    const allowed: (keyof MemberRow)[] = ["prenom", "role", "date_naissance", "etablissement", "classe", "cantine_jours", "cantine_cout_mois", "notes"];
    const keys = allowed.filter((k) => k in patch);
    if (!keys.length) return;
    this.raw.prepare(`UPDATE members SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as never), id);
  }

  getMember(id: string): MemberRow | undefined {
    return this.raw.prepare("SELECT * FROM members WHERE id = ?").get(id) as MemberRow | undefined;
  }

  setMemberPhoto(id: string, photo: string | null) {
    this.raw.prepare("UPDATE members SET photo = ? WHERE id = ?").run(photo, id);
  }

  deleteMember(id: string) {
    this.raw.prepare("UPDATE documents SET member_id = NULL WHERE member_id = ?").run(id);
    this.raw.prepare("DELETE FROM activites WHERE member_id = ?").run(id);
    this.raw.prepare("DELETE FROM members WHERE id = ?").run(id);
  }

  listMembers(household_id: string): MemberRow[] {
    const order = { adulte: 0, enfant: 1, parent_a_charge: 2, autre_a_charge: 3 } as Record<string, number>;
    const rows = this.raw.prepare("SELECT * FROM members WHERE household_id = ?").all(household_id) as unknown as MemberRow[];
    return rows.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || (a.date_naissance ?? "9").localeCompare(b.date_naissance ?? "9") || a.prenom.localeCompare(b.prenom));
  }

  // ---------- activités (agenda de la famille) ----------
  insertActivite(a: Omit<ActiviteRow, "id">): ActiviteRow {
    const row: ActiviteRow = { ...a, id: randomUUID() };
    this.raw
      .prepare("INSERT INTO activites (id, household_id, member_id, titre, type, jour, heure_debut, heure_fin, lieu, cout_mois, date_debut, date_fin, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.household_id, row.member_id, row.titre, row.type, row.jour, row.heure_debut, row.heure_fin, row.lieu, row.cout_mois, row.date_debut, row.date_fin, row.note);
    return row;
  }

  updateActivite(id: string, patch: Partial<ActiviteRow>) {
    const allowed: (keyof ActiviteRow)[] = ["member_id", "titre", "type", "jour", "heure_debut", "heure_fin", "lieu", "cout_mois", "date_debut", "date_fin", "note"];
    const keys = allowed.filter((k) => k in patch);
    if (!keys.length) return;
    this.raw.prepare(`UPDATE activites SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as never), id);
  }

  getActivite(id: string): ActiviteRow | undefined {
    return this.raw.prepare("SELECT * FROM activites WHERE id = ?").get(id) as ActiviteRow | undefined;
  }

  deleteActivite(id: string) {
    this.raw.prepare("DELETE FROM activites WHERE id = ?").run(id);
  }

  listActivites(household_id: string): ActiviteRow[] {
    return this.raw.prepare("SELECT * FROM activites WHERE household_id = ? ORDER BY jour, heure_debut, titre").all(household_id) as unknown as ActiviteRow[];
  }

  // ---------- push subscriptions ----------
  savePushSubscription(s: { household_id: string; user_id: string | null; endpoint: string; p256dh: string; auth: string; appareil: string | null }) {
    this.raw.prepare("INSERT INTO push_subscriptions (id, household_id, user_id, endpoint, p256dh, auth, appareil, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET household_id = excluded.household_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, appareil = excluded.appareil")
      .run(randomUUID(), s.household_id, s.user_id, s.endpoint, s.p256dh, s.auth, s.appareil, this.now());
  }

  /** Without a household: only for the push service's own "this device is gone" answers (404/410). */
  deletePushSubscription(endpoint: string, household_id?: string) {
    if (household_id) this.raw.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND household_id = ?").run(endpoint, household_id);
    else this.raw.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  listPushSubscriptions(household_id: string): PushSubscriptionRow[] {
    return this.raw.prepare("SELECT * FROM push_subscriptions WHERE household_id = ?").all(household_id) as unknown as PushSubscriptionRow[];
  }

  /** Family deadlines (computed, not stored) marked as done by their key. */
  marquerFamilleFait(household_id: string, cle: string, fait: boolean) {
    if (fait) this.raw.prepare("INSERT OR IGNORE INTO famille_faits (household_id, cle, quand) VALUES (?, ?, ?)").run(household_id, cle, this.now());
    else this.raw.prepare("DELETE FROM famille_faits WHERE household_id = ? AND cle = ?").run(household_id, cle);
  }

  familleFaits(household_id: string): Set<string> {
    return new Set((this.raw.prepare("SELECT cle FROM famille_faits WHERE household_id = ?").all(household_id) as unknown as { cle: string }[]).map((r) => r.cle));
  }

  // ---------- documents ----------
  insertDocument(doc: Omit<DocumentRow, "id" | "cree_le" | "verifie" | "source"> & { verifie?: number; source?: string }): DocumentRow {
    const row: DocumentRow = { ...doc, id: randomUUID(), cree_le: this.now(), verifie: doc.verifie ?? 0, source: doc.source ?? "app" };
    this.raw
      .prepare(
        `INSERT INTO documents (id, household_id, member_id, title, category, organisme, numero_contrat, montant, periodicite,
          date_document, date_debut, date_fin, preavis_jours, resume, texte, fichier, mime, confiance, verifie, source, cree_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id, row.household_id, row.member_id, row.title, row.category, row.organisme, row.numero_contrat,
        row.montant, row.periodicite, row.date_document, row.date_debut, row.date_fin, row.preavis_jours,
        row.resume, row.texte, row.fichier, row.mime, row.confiance, row.verifie, row.source, row.cree_le
      );
    return row;
  }

  updateDocument(id: string, patch: Partial<DocumentRow>) {
    const allowed: (keyof DocumentRow)[] = [
      "member_id", "title", "category", "organisme", "numero_contrat", "montant", "periodicite",
      "date_document", "date_debut", "date_fin", "preavis_jours", "resume", "verifie",
    ];
    const keys = allowed.filter((k) => patch[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = ?`).join(", ");
    this.raw.prepare(`UPDATE documents SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k] as any), id);
  }

  getDocument(id: string): DocumentRow | undefined {
    return this.raw.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
  }

  listDocuments(household_id: string, opts: { category?: string; q?: string } = {}): DocumentRow[] {
    let sql = "SELECT * FROM documents WHERE household_id = ?";
    const args: any[] = [household_id];
    if (opts.category) {
      sql += " AND category = ?";
      args.push(opts.category);
    }
    if (opts.q) {
      sql += " AND (title LIKE ? OR organisme LIKE ? OR resume LIKE ? OR numero_contrat LIKE ? OR texte LIKE ?)";
      const like = `%${opts.q}%`;
      args.push(like, like, like, like, like);
    }
    sql += " ORDER BY cree_le DESC";
    return this.raw.prepare(sql).all(...args) as unknown as DocumentRow[];
  }

  countDocuments(household_id: string): number {
    const r = this.raw.prepare("SELECT COUNT(*) AS n FROM documents WHERE household_id = ?").get(household_id) as { n: number };
    return r.n;
  }

  deleteDocument(id: string) {
    this.raw.prepare("DELETE FROM deadlines WHERE document_id = ?").run(id);
    this.raw.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }

  // ---------- deadlines ----------
  replaceDeadlinesForDocument(document_id: string, household_id: string, items: Omit<DeadlineRow, "id" | "household_id" | "document_id" | "fait">[]) {
    this.raw.prepare("DELETE FROM deadlines WHERE document_id = ? AND fait = 0").run(document_id);
    const stmt = this.raw.prepare(
      "INSERT INTO deadlines (id, household_id, document_id, titre, type, date, rappel_jours, fait, note) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)"
    );
    for (const d of items) stmt.run(randomUUID(), household_id, document_id, d.titre, d.type, d.date, d.rappel_jours, d.note);
  }

  insertDeadline(d: Omit<DeadlineRow, "id" | "fait">): DeadlineRow {
    const row: DeadlineRow = { ...d, id: randomUUID(), fait: 0 };
    this.raw
      .prepare("INSERT INTO deadlines (id, household_id, document_id, titre, type, date, rappel_jours, fait, note) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .run(row.id, row.household_id, row.document_id, row.titre, row.type, row.date, row.rappel_jours, row.note);
    return row;
  }

  listDeadlines(household_id: string, opts: { from?: string; to?: string; includeDone?: boolean } = {}): DeadlineRow[] {
    let sql = "SELECT * FROM deadlines WHERE household_id = ?";
    const args: any[] = [household_id];
    if (!opts.includeDone) sql += " AND fait = 0";
    if (opts.from) { sql += " AND date >= ?"; args.push(opts.from); }
    if (opts.to) { sql += " AND date <= ?"; args.push(opts.to); }
    sql += " ORDER BY date ASC";
    return this.raw.prepare(sql).all(...args) as unknown as DeadlineRow[];
  }

  /** Only within the household: an id from another household changes nothing (returns false). */
  setDeadlineDone(household_id: string, id: string, fait: boolean): boolean {
    return Number(this.raw.prepare("UPDATE deadlines SET fait = ? WHERE id = ? AND household_id = ?").run(fait ? 1 : 0, id, household_id).changes) > 0;
  }

  // ---------- transactions ----------
  insertTransactions(rows: Omit<TransactionRow, "id" | "importe_le">[]): number {
    const stmt = this.raw.prepare(
      "INSERT OR IGNORE INTO transactions (id, household_id, compte, date, libelle, marchand, montant, categorie, empreinte, importe_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    let n = 0;
    for (const r of rows) {
      const res = stmt.run(randomUUID(), r.household_id, r.compte, r.date, r.libelle, r.marchand, r.montant, r.categorie, r.empreinte, this.now());
      n += Number(res.changes);
    }
    return n;
  }

  listTransactions(household_id: string, opts: { from?: string; to?: string } = {}): TransactionRow[] {
    let sql = "SELECT * FROM transactions WHERE household_id = ?";
    const args: any[] = [household_id];
    if (opts.from) { sql += " AND date >= ?"; args.push(opts.from); }
    if (opts.to) { sql += " AND date <= ?"; args.push(opts.to); }
    sql += " ORDER BY date DESC";
    return this.raw.prepare(sql).all(...args) as unknown as TransactionRow[];
  }

  /** Only within the household: an id from another household changes nothing (returns false). */
  updateTransactionCategory(household_id: string, id: string, categorie: string): boolean {
    return Number(this.raw.prepare("UPDATE transactions SET categorie = ? WHERE id = ? AND household_id = ?").run(categorie, id, household_id).changes) > 0;
  }

  setDecision(household_id: string, cle: string, decision: string) {
    this.raw
      .prepare("INSERT INTO budget_decisions (household_id, cle, decision, quand) VALUES (?, ?, ?, ?) ON CONFLICT(household_id, cle) DO UPDATE SET decision = excluded.decision, quand = excluded.quand")
      .run(household_id, cle, decision, this.now());
  }

  listDecisions(household_id: string): Record<string, string> {
    const rows = this.raw.prepare("SELECT cle, decision FROM budget_decisions WHERE household_id = ?").all(household_id) as unknown as { cle: string; decision: string }[];
    return Object.fromEntries(rows.map((r) => [r.cle, r.decision]));
  }

  // ---------- bank link (aggregator) ----------
  getBankLink(household_id: string): BankLinkRow | undefined {
    return this.raw.prepare("SELECT * FROM bank_links WHERE household_id = ?").get(household_id) as unknown as BankLinkRow | undefined;
  }

  getBankLinkByUser(user_uuid: string): BankLinkRow | undefined {
    return this.raw.prepare("SELECT * FROM bank_links WHERE user_uuid = ?").get(user_uuid) as unknown as BankLinkRow | undefined;
  }

  upsertBankLink(link: Omit<BankLinkRow, "cree_le">) {
    this.raw
      .prepare(
        `INSERT INTO bank_links (household_id, fournisseur, user_uuid, external_user_id, derniere_synchro, curseur, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(household_id) DO UPDATE SET fournisseur = excluded.fournisseur, user_uuid = excluded.user_uuid, external_user_id = excluded.external_user_id,
         derniere_synchro = excluded.derniere_synchro, curseur = excluded.curseur, statut = excluded.statut`
      )
      .run(link.household_id, link.fournisseur, link.user_uuid, link.external_user_id, link.derniere_synchro, link.curseur, link.statut, this.now());
  }

  deleteBankLink(household_id: string) {
    this.raw.prepare("DELETE FROM bank_accounts WHERE household_id = ?").run(household_id);
    this.raw.prepare("DELETE FROM bank_links WHERE household_id = ?").run(household_id);
  }

  upsertBankAccount(a: BankAccountRow) {
    this.raw
      .prepare(
        `INSERT INTO bank_accounts (id, household_id, item_id, nom, banque, type, solde, devise, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, nom = excluded.nom, banque = excluded.banque, type = excluded.type, solde = excluded.solde, devise = excluded.devise, maj_le = excluded.maj_le`
      )
      .run(a.id, a.household_id, a.item_id, a.nom, a.banque, a.type, a.solde, a.devise, a.maj_le);
  }

  listBankAccounts(household_id: string): BankAccountRow[] {
    return this.raw.prepare("SELECT * FROM bank_accounts WHERE household_id = ? ORDER BY nom").all(household_id) as unknown as BankAccountRow[];
  }

  // ---------- IA usage: per-household monthly quota + global monthly spend cap ----------
  private month(): string { return this.now().slice(0, 7); }

  /** Estimated AI spend of the household this month, in cents (all AI calls, see iaBudget.ts). */
  iaCentimesMois(household_id: string): number {
    this.ensureIaCentimes();
    const r = this.raw.prepare("SELECT centimes FROM ia_usage WHERE household_id = ? AND mois = ?").get(household_id, this.month()) as { centimes: number } | undefined;
    return r?.centimes ?? 0;
  }
  private iaCentimesPret = false;
  private ensureIaCentimes() {
    if (this.iaCentimesPret) return;
    const cols = (this.raw.prepare("PRAGMA table_info(ia_usage)").all() as unknown as { name: string }[]).map((c) => c.name);
    if (!cols.includes("centimes")) this.raw.exec("ALTER TABLE ia_usage ADD COLUMN centimes REAL NOT NULL DEFAULT 0");
    this.iaCentimesPret = true;
  }

  /** Records an AI call that is not a paper reading (categorisation, letter, PDF statement) and its cost. */
  recordIaCout(household_id: string, gratuit: boolean, centimes: number) {
    this.ensureIaCentimes();
    const m = this.month();
    this.raw.prepare("INSERT INTO ia_usage (household_id, mois, lectures, centimes) VALUES (?, ?, 0, ?) ON CONFLICT(household_id, mois) DO UPDATE SET centimes = centimes + excluded.centimes").run(household_id, m, centimes);
    this.raw
      .prepare(`INSERT INTO ia_depense (mois, centimes_gratuit, centimes_payant) VALUES (?, ?, ?)
                ON CONFLICT(mois) DO UPDATE SET centimes_gratuit = centimes_gratuit + excluded.centimes_gratuit, centimes_payant = centimes_payant + excluded.centimes_payant`)
      .run(m, gratuit ? centimes : 0, gratuit ? 0 : centimes);
  }

  iaLecturesMois(household_id: string): number {
    const r = this.raw.prepare("SELECT lectures FROM ia_usage WHERE household_id = ? AND mois = ?").get(household_id, this.month()) as { lectures: number } | undefined;
    return r?.lectures ?? 0;
  }

  /** Records one AI reading and its estimated cost in cents, in the free or paid bucket. */
  recordIaLecture(household_id: string, gratuit: boolean, centimes: number) {
    this.ensureIaCentimes();
    const m = this.month();
    this.raw.prepare("INSERT INTO ia_usage (household_id, mois, lectures, centimes) VALUES (?, ?, 1, ?) ON CONFLICT(household_id, mois) DO UPDATE SET lectures = lectures + 1, centimes = centimes + excluded.centimes").run(household_id, m, centimes);
    this.raw
      .prepare(`INSERT INTO ia_depense (mois, centimes_gratuit, centimes_payant) VALUES (?, ?, ?)
                ON CONFLICT(mois) DO UPDATE SET centimes_gratuit = centimes_gratuit + excluded.centimes_gratuit, centimes_payant = centimes_payant + excluded.centimes_payant`)
      .run(m, gratuit ? centimes : 0, gratuit ? 0 : centimes);
  }

  iaDepenseMois(): { gratuit_eur: number; payant_eur: number } {
    const r = this.raw.prepare("SELECT centimes_gratuit, centimes_payant FROM ia_depense WHERE mois = ?").get(this.month()) as { centimes_gratuit: number; centimes_payant: number } | undefined;
    return { gratuit_eur: (r?.centimes_gratuit ?? 0) / 100, payant_eur: (r?.centimes_payant ?? 0) / 100 };
  }

  // ---------- waitlist (site) ----------
  addToWaitlist(email: string, situation: string | null, source: string | null): boolean {
    const r = this.raw.prepare("INSERT OR IGNORE INTO waitlist (email, situation, source, cree_le) VALUES (?, ?, ?, ?)").run(email.toLowerCase().trim(), situation, source, this.now());
    return Number(r.changes) > 0;
  }

  countWaitlist(): number {
    return (this.raw.prepare("SELECT COUNT(*) AS n FROM waitlist").get() as { n: number }).n;
  }

  // ---------- MCP access log ----------
  logMcpAccess(household_id: string, outil: string, args: unknown) {
    this.raw
      .prepare("INSERT INTO mcp_access_log (id, household_id, outil, arguments, quand) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), household_id, outil, JSON.stringify(args ?? {}), this.now());
  }

  listMcpAccess(household_id: string, limit = 50) {
    return this.raw
      .prepare("SELECT * FROM mcp_access_log WHERE household_id = ? ORDER BY quand DESC LIMIT ?")
      .all(household_id, limit);
  }
}
