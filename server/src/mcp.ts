import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { familleReport, JOURS, coutsParMembre } from "./famille.js";
import { dateFinCourante } from "./deadlines.js";
import type { Db, DocumentRow } from "./db.js";
import { chargesReport, lignesFamille } from "./charges.js";
import { publicDoc } from "./api.js";
import { budgetReport } from "./budget.js";

/**
 * Lucien MCP server — read-only access to a household's papers for any MCP-compatible assistant
 * (Claude, ChatGPT, Cursor…). Every call is written to the household's access log so the family
 * can see which AI looked at what.
 *
 * Scope control: a household can exclude categories from the connector (LUCIEN_MCP_EXCLUDE, comma list).
 */
export function createMcpServer(db: Db, householdId: string) {
  const server = new McpServer({ name: "lucien", version: "0.1.0" });
  const excluded = new Set((process.env.LUCIEN_MCP_EXCLUDE ?? "sante,banque").split(",").map((s) => s.trim()).filter(Boolean));
  const visible = () => db.listDocuments(householdId).filter((d) => !excluded.has(d.category));
  const log = (outil: string, args: unknown) => db.logMcpAccess(householdId, outil, args);
  const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  // Internal identifiers that mean nothing to an assistant and only leak structure.
  const sansFoyer = <T extends { household_id?: unknown }>({ household_id, ...rest }: T) => rest;
  // End of the current term: a contract renewed by tacit reconduction is still running.
  const fin = (d: DocumentRow) => {
    const courante = dateFinCourante(d);
    return courante !== d.date_fin ? { date_fin: courante, reconduit_tacitement: true, date_fin_initiale: d.date_fin } : { date_fin: d.date_fin };
  };

  server.registerTool(
    "lister_documents",
    {
      title: "Lister les documents du foyer",
      description:
        "Liste les papiers de la famille (contrats, factures, attestations…). Filtrable par catégorie : assurance, energie, telecom, logement, impots, abonnement, identite, garantie, education, vehicule, autre. Les catégories santé et banque sont exclues par défaut.",
      inputSchema: { category: z.string().optional().describe("Catégorie à filtrer"), q: z.string().optional().describe("Mot-clé (organisme, titre, numéro)") },
    },
    async ({ category, q }) => {
      log("lister_documents", { category, q });
      let docs = visible();
      if (category) docs = docs.filter((d) => d.category === category);
      if (q) {
        const needle = q.toLowerCase();
        docs = docs.filter((d) => [d.title, d.organisme, d.resume, d.numero_contrat].some((v) => v?.toLowerCase().includes(needle)));
      }
      return text(docs.map((d) => ({ id: d.id, titre: d.title, categorie: d.category, organisme: d.organisme, montant: d.montant, periodicite: d.periodicite, ...fin(d), resume: d.resume })));
    }
  );

  server.registerTool(
    "detail_document",
    {
      title: "Détail d'un document",
      description: "Tous les champs extraits d'un document (numéro de contrat, montants, dates, préavis) et ses échéances associées.",
      inputSchema: { id: z.string().describe("Identifiant du document") },
    },
    async ({ id }) => {
      log("detail_document", { id });
      const d = db.getDocument(id);
      if (!d || d.household_id !== householdId || excluded.has(d.category)) return text({ erreur: "Document introuvable ou hors périmètre du connecteur." });
      return text({ ...sansFoyer(publicDoc(d)), ...fin(d), echeances: db.listDeadlines(householdId, { includeDone: true }).filter((x) => x.document_id === d.id).map(sansFoyer) });
    }
  );

  server.registerTool(
    "famille",
    {
      title: "Organisation de la famille",
      description: "Composition du foyer (adultes, enfants avec école et classe, personnes à charge), agenda de la semaine (activités, cantine), coût mensuel des enfants et dates clés (bourses, Parcoursup, réinscriptions). Sans date de naissance ni données de santé.",
      inputSchema: {},
    },
    async () => {
      log("famille", {});
      const h = db.getHousehold(householdId)!;
      const r = familleReport(h, db.listMembers(householdId), db.listActivites(householdId), db.familleFaits(householdId));
      return text({
        situation: r.situation, composition: r.composition,
        membres: r.membres.map((m) => ({ prenom: m.prenom, role: m.role_label, age: m.age, niveau: m.niveau, etablissement: m.etablissement, classe: m.classe, cantine_jours: m.cantine_jours })),
        semaine: r.semaine.map((s) => ({ jour: JOURS[s.jour], de: s.heure_debut, a: s.heure_fin, quoi: s.titre, qui: s.membre, ou: s.lieu })),
        cout_enfants_mois: r.cout_enfants_mois, couts: r.couts,
        dates_cles: r.echeances.filter((e) => !e.fait).map((e) => ({ date: e.date, titre: e.titre, note: e.note })),
      });
    }
  );

  server.registerTool(
    "echeances",
    {
      title: "Échéances à venir",
      description: "Les échéances du foyer (résiliation, renouvellement, expiration, garantie, paiement) entre deux dates. Par défaut : les 90 prochains jours.",
      inputSchema: { from: z.string().optional().describe("AAAA-MM-JJ"), to: z.string().optional().describe("AAAA-MM-JJ") },
    },
    async ({ from, to }) => {
      log("echeances", { from, to });
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
      const excludedDocIds = new Set(db.listDocuments(householdId).filter((d) => excluded.has(d.category)).map((d) => d.id));
      const items = db.listDeadlines(householdId, { from: from ?? today, to: to ?? end }).filter((d) => !d.document_id || !excludedDocIds.has(d.document_id));
      return text(items.map(sansFoyer));
    }
  );

  server.registerTool(
    "charges_fixes",
    {
      title: "Charges fixes et économies possibles",
      description: "Le budget des dépenses récurrentes du foyer reconstitué à partir des contrats (total mensuel, répartition par catégorie) et les alertes d'économies : doublons, hausses de tarif, fin d'engagement, assurances résiliables à tout moment (loi Hamon), contrats non renégociés.",
      inputSchema: {},
    },
    async () => {
      log("charges_fixes", {});
      // Canteen and paid activities are recurring costs too: taken from the family, not from contracts.
      const lignes = lignesFamille(coutsParMembre(db.listMembers(householdId), db.listActivites(householdId))).filter((l) => !excluded.has(l.category));
      const r = chargesReport(visible(), undefined, lignes);
      return text(r);
    }
  );

  server.registerTool(
    "rechercher",
    {
      title: "Rechercher dans les papiers",
      description: "Recherche plein texte dans les documents du foyer (titre, organisme, résumé, numéro, contenu).",
      inputSchema: { q: z.string().min(2) },
    },
    async ({ q }) => {
      log("rechercher", { q });
      const docs = db.listDocuments(householdId, { q }).filter((d) => !excluded.has(d.category));
      return text(docs.map((d) => ({ id: d.id, titre: d.title, categorie: d.category, organisme: d.organisme, resume: d.resume, ...correspondance(d, q) })));
    }
  );

  // Not offered at all when the bank scope is excluded: an assistant would only call it to get an error.
  if (!excluded.has("banque")) server.registerTool(
    "analyse_depenses",
    {
      title: "Analyse des dépenses et économies faciles",
      description:
        "Budget réel du foyer à partir des relevés bancaires importés : dépenses par poste (mois courant vs moyenne), revenus, reste à vivre, prélèvements récurrents, et la liste classée des économies faciles (abonnements fantômes, hausses, doublons, frais bancaires, dérives). Les montants individuels des opérations ne sont pas exposés.",
      inputSchema: {},
    },
    async () => {
      log("analyse_depenses", {});
      const r = budgetReport(db.listTransactions(householdId), db.listDocuments(householdId), db.listDecisions(householdId));
      const { recurrences, ...rest } = r;
      return text({ ...rest, recurrences: recurrences.map((x) => ({ marchand: x.marchand, categorie: x.categorie, mensuel: x.mensuel_equivalent, jour: x.jour_du_mois, contrat_connu: Boolean(x.contrat_id) })) });
    }
  );

  return server;
}

const CHAMPS: [keyof DocumentRow, string][] = [["title", "titre"], ["organisme", "organisme"], ["numero_contrat", "numéro"], ["resume", "résumé"], ["texte", "contenu"]];

/** Where the search term was found, with a short excerpt around it (the full text is never returned). */
function correspondance(d: DocumentRow, q: string): { trouve_dans: string | null; extrait: string | null } {
  const needle = q.toLowerCase();
  for (const [champ, label] of CHAMPS) {
    const v = d[champ];
    if (typeof v !== "string") continue;
    const i = v.toLowerCase().indexOf(needle);
    if (i < 0) continue;
    const start = Math.max(0, i - 80), end = Math.min(v.length, i + needle.length + 120);
    const extrait = (start > 0 ? "…" : "") + v.slice(start, end).replace(/\s+/g, " ").trim() + (end < v.length ? "…" : "");
    return { trouve_dans: label, extrait };
  }
  return { trouve_dans: null, extrait: null };
}

/** Handles one HTTP request for the MCP endpoint (stateless: a fresh transport per request). */
/**
 * The bearer token identifies the household (each household has its own `mcp_token`, shown in the app's settings).
 * LUCIEN_MCP_TOKEN, if set, remains accepted for the first household (single-household prototype).
 */
export async function handleMcpRequest(db: Db, req: Request, pathToken?: string): Promise<Response> {
  const unauthorized = () => new Response(JSON.stringify({ error: "non autorisé" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } });
  const auth = req.headers.get("authorization") ?? "";
  // claude.ai custom connectors only take a URL: the token may also sit in the path (/mcp/<token>).
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (pathToken ?? "").trim();
  if (!bearer) return unauthorized();
  let h = db.householdByMcpToken(bearer);
  if (!h && process.env.LUCIEN_MCP_TOKEN && bearer === process.env.LUCIEN_MCP_TOKEN) h = db.firstHousehold();
  if (!h) return unauthorized();
  if (db.effectivePlan(h) !== "famille") return new Response(JSON.stringify({ error: "plan", message: "Le connecteur IA fait partie du plan Famille." }), { status: 402, headers: { "content-type": "application/json" } });
  const server = createMcpServer(db, h.id);
  // Stateless + plain JSON responses: one transport per request, closed once the response is written.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  void transport.close().catch(() => {});
  return res;
}
