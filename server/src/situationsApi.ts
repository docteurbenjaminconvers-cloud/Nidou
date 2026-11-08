/**
 * Situations de vie, stored per household: each applicable step becomes a deadline (type « situation ») placed at its
 * date in the Agenda and the reminders; ticking a step marks its deadline done, and the other way round.
 */
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { dateEtape, etapesApplicables, lettreAdresse, lettreCongeLocataire, papiersConcernes, situationParCle, SITUATIONS, type CleSituation } from "./situations.js";

export interface SituationRow { id: string; household_id: string; cle: CleSituation; date: string; options: string; cree_le: string }
interface Options { locataire: boolean; ancienne_adresse?: string | null; nouvelle_adresse?: string | null; meuble?: boolean; zone_tendue?: boolean; bailleur?: string | null }

export function ensureSituationsSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS situations (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, cle TEXT NOT NULL, date TEXT NOT NULL, options TEXT NOT NULL, cree_le TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS situation_etapes (situation_id TEXT NOT NULL, household_id TEXT NOT NULL, cle TEXT NOT NULL, deadline_id TEXT NOT NULL, PRIMARY KEY (situation_id, cle));`);
}

/** A situation with its steps, dates, done state and the papers concerned. */
export function vueSituation(db: Db, s: SituationRow) {
  const def = situationParCle(s.cle)!;
  const opts = JSON.parse(s.options) as Options;
  const liens = new Map((db.raw.prepare("SELECT cle, deadline_id FROM situation_etapes WHERE situation_id = ?").all(s.id) as unknown as { cle: string; deadline_id: string }[]).map((r) => [r.cle, r.deadline_id]));
  const faits = new Set((db.raw.prepare("SELECT id FROM deadlines WHERE household_id = ? AND type = 'situation' AND fait = 1").all(s.household_id) as unknown as { id: string }[]).map((r) => r.id));
  const docs = db.listDocuments(s.household_id);
  const etapes = etapesApplicables(def, { locataire: opts.locataire }).map((e) => ({
    cle: e.cle, titre: e.titre, detail: e.detail, date: dateEtape(s.date, e.j), lien: e.lien ?? null, dossier: e.dossier ?? null, ecran: e.ecran ?? null, courrier: e.courrier ?? null,
    deadline_id: liens.get(e.cle) ?? null, fait: faits.has(liens.get(e.cle) ?? ""),
    papiers: papiersConcernes(e, docs).map((d) => ({ id: d.id, title: d.title, organisme: d.organisme })),
  }));
  return { id: s.id, cle: s.cle, titre: def.titre, date: s.date, options: opts, etapes, faites: etapes.filter((e) => e.fait).length };
}

export function monterSituations(api: Hono<any>, db: Db, ctx: { household: (c: any) => { id: string; nom: string }; prenom: (c: any) => string | null }) {
  ensureSituationsSchema(db);
  const liste = (hid: string) => (db.raw.prepare("SELECT * FROM situations WHERE household_id = ? ORDER BY date").all(hid) as unknown as SituationRow[]).map((s) => vueSituation(db, s));
  const duFoyer = (c: any, id: string) => { const s = db.raw.prepare("SELECT * FROM situations WHERE id = ?").get(id) as unknown as SituationRow | undefined; return s && s.household_id === ctx.household(c).id ? s : null; };

  api.get("/situations", (c) => c.json({
    catalogue: SITUATIONS.map((s) => ({ cle: s.cle, titre: s.titre, accroche: s.accroche, question: s.question, icone: s.icone, teinte: s.teinte, etapes: s.etapes.length, locataire: s.etapes.some((e) => e.si === "locataire") })),
    actives: liste(ctx.household(c).id),
  }));

  api.post("/situations", async (c) => {
    const hid = ctx.household(c).id;
    const b = z.object({
      cle: z.enum(SITUATIONS.map((s) => s.cle) as [CleSituation, ...CleSituation[]]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      locataire: z.boolean().default(false), ancienne_adresse: z.string().max(300).nullable().optional(), nouvelle_adresse: z.string().max(300).nullable().optional(),
      meuble: z.boolean().optional(), zone_tendue: z.boolean().optional(), bailleur: z.string().max(300).nullable().optional(),
    }).parse(await c.req.json());
    if ((db.raw.prepare("SELECT COUNT(*) AS n FROM situations WHERE household_id = ?").get(hid) as { n: number }).n >= 20) return c.json({ error: "trop", message: "Terminez ou supprimez une situation avant d'en ouvrir une autre." }, 400);
    const def = situationParCle(b.cle)!;
    const { cle, date, ...options } = b;
    const id = randomUUID();
    db.raw.exec("BEGIN");
    try {
      db.raw.prepare("INSERT INTO situations (id, household_id, cle, date, options, cree_le) VALUES (?, ?, ?, ?, ?, ?)").run(id, hid, cle, date, JSON.stringify(options), new Date().toISOString());
      for (const e of etapesApplicables(def, { locataire: b.locataire })) {
        // a step whose ideal date has already passed (situation opened late) goes in the agenda for today, not « en retard »
        const ideale = dateEtape(date, e.j), auj = new Date().toISOString().slice(0, 10);
        const d = db.insertDeadline({ household_id: hid, document_id: null, titre: `${def.titre} : ${e.titre}`, type: "situation", date: ideale < auj ? auj : ideale, rappel_jours: e.j < -30 ? 14 : 5, note: ideale < auj ? "À faire dès que possible : la date idéale est passée." : null });
        db.raw.prepare("INSERT INTO situation_etapes (situation_id, household_id, cle, deadline_id) VALUES (?, ?, ?, ?)").run(id, hid, e.cle, d.id);
      }
      db.raw.exec("COMMIT");
    } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
    return c.json(vueSituation(db, db.raw.prepare("SELECT * FROM situations WHERE id = ?").get(id) as unknown as SituationRow), 201);
  });

  api.patch("/situations/:id/etapes/:cle", async (c) => {
    const s = duFoyer(c, c.req.param("id"));
    if (!s) return c.json({ error: "introuvable" }, 404);
    const b = z.object({ fait: z.boolean() }).parse(await c.req.json());
    const r = db.raw.prepare("SELECT deadline_id FROM situation_etapes WHERE situation_id = ? AND cle = ?").get(s.id, c.req.param("cle")) as { deadline_id: string } | undefined;
    if (!r) return c.json({ error: "introuvable" }, 404);
    db.setDeadlineDone(s.household_id, r.deadline_id, b.fait);
    return c.json(vueSituation(db, s));
  });

  /** Closing a situation removes its steps not done yet from the Agenda; the ones done stay in the history. */
  api.delete("/situations/:id", (c) => {
    const s = duFoyer(c, c.req.param("id"));
    if (!s) return c.json({ error: "introuvable" }, 404);
    db.raw.prepare("DELETE FROM deadlines WHERE household_id = ? AND fait = 0 AND id IN (SELECT deadline_id FROM situation_etapes WHERE situation_id = ?)").run(s.household_id, s.id);
    db.raw.prepare("DELETE FROM situation_etapes WHERE situation_id = ?").run(s.id);
    db.raw.prepare("DELETE FROM situations WHERE id = ?").run(s.id);
    return c.json({ ok: true });
  });

  /** The letter of a step: change of address for one paper, or the tenant's notice. */
  api.get("/situations/:id/courrier", (c) => {
    const s = duFoyer(c, c.req.param("id"));
    if (!s) return c.json({ error: "introuvable" }, 404);
    const opts = JSON.parse(s.options) as Options;
    const expediteur = ctx.prenom(c) ? `${ctx.prenom(c)} (${ctx.household(c).nom})` : ctx.household(c).nom;
    const etape = situationParCle(s.cle)!.etapes.find((e) => e.cle === c.req.query("etape"));
    if (!etape?.courrier) return c.json({ error: "introuvable" }, 404);
    if (etape.courrier === "conge_locataire") return c.json({ lettre: lettreCongeLocataire({ expediteur, adresse: opts.ancienne_adresse ?? "", bailleur: opts.bailleur, meuble: !!opts.meuble, zone_tendue: !!opts.zone_tendue, date: s.date }) });
    const doc = c.req.query("doc") ? db.getDocument(c.req.query("doc")!) : null;
    if (doc && doc.household_id !== s.household_id) return c.json({ error: "introuvable" }, 404);
    return c.json({ lettre: lettreAdresse({ expediteur, organisme: doc?.organisme ?? "[organisme]", contrat: doc?.numero_contrat, ancienne: opts.ancienne_adresse ?? "", nouvelle: opts.nouvelle_adresse ?? "", date: s.date }) });
  });
}
