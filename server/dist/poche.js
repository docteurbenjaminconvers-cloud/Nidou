import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LIBELLE_VERSEMENT, etatPoche, signe, versementsDus } from "./pocheCalcul.js";
export * from "./pocheCalcul.js";
export function ensurePocheSchema(db) {
    db.raw.exec(`CREATE TABLE IF NOT EXISTS poche_reglages (
    household_id TEXT NOT NULL, member_id TEXT NOT NULL, montant REAL NOT NULL, frequence TEXT NOT NULL, jour INTEGER NOT NULL, depuis TEXT NOT NULL, actif INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (household_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS poche_mouvements (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, member_id TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, montant REAL NOT NULL, libelle TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS poche_versement_unique ON poche_mouvements (household_id, member_id, date) WHERE auto = 1;
  CREATE INDEX IF NOT EXISTS poche_mouvements_membre ON poche_mouvements (household_id, member_id, date);
  CREATE TABLE IF NOT EXISTS poche_objectifs (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, member_id TEXT NOT NULL, titre TEXT NOT NULL, cible REAL NOT NULL, mis_de_cote REAL NOT NULL DEFAULT 0, cree_le TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS poche_missions (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, member_id TEXT NOT NULL, titre TEXT NOT NULL, montant REAL NOT NULL, cree_le TEXT NOT NULL);`);
}
const c2 = (n) => Math.round(n * 100) / 100;
const montant = z.number().positive().max(10_000);
/** One child's kitty, the allowance days that have passed being credited first. */
export function lirePoche(db, hid, m, aujourdhui = new Date().toISOString().slice(0, 10)) {
    const r = db.raw.prepare("SELECT member_id, montant, frequence, jour, depuis, actif FROM poche_reglages WHERE household_id = ? AND member_id = ?").get(hid, m.id);
    const reglage = r ? { ...r, actif: !!r.actif } : null;
    if (reglage) {
        const dernier = db.raw.prepare("SELECT MAX(date) d FROM poche_mouvements WHERE household_id = ? AND member_id = ? AND auto = 1").get(hid, m.id).d;
        const ins = db.raw.prepare("INSERT OR IGNORE INTO poche_mouvements (id, household_id, member_id, date, type, montant, libelle, auto, cree_le) VALUES (?, ?, ?, ?, 'versement', ?, ?, 1, ?)");
        for (const d of versementsDus(reglage, dernier, aujourdhui))
            ins.run(randomUUID(), hid, m.id, d, reglage.montant, LIBELLE_VERSEMENT(reglage.frequence), new Date().toISOString());
    }
    const mouvements = db.raw.prepare("SELECT id, member_id, date, type, montant, libelle, auto FROM poche_mouvements WHERE household_id = ? AND member_id = ? ORDER BY date DESC, cree_le DESC, rowid DESC").all(hid, m.id).map((x) => ({ ...x, auto: !!x.auto }));
    const objectifs = db.raw.prepare("SELECT id, member_id, titre, cible, mis_de_cote, cree_le FROM poche_objectifs WHERE household_id = ? AND member_id = ? ORDER BY cree_le").all(hid, m.id);
    const missions = db.raw.prepare("SELECT id, member_id, titre, montant, cree_le FROM poche_missions WHERE household_id = ? AND member_id = ? ORDER BY cree_le").all(hid, m.id);
    return etatPoche({ member_id: m.id, prenom: m.prenom, reglage, mouvements, objectifs, missions, aujourdhui });
}
export function monterPoche(api, db, ctx) {
    ensurePocheSchema(db);
    const enfants = (hid) => db.listMembers(hid).filter((m) => m.role === "enfant");
    const enfant = (c) => enfants(ctx.household(c).id).find((m) => m.id === c.req.param("membre"));
    const refus = (c) => c.json({ error: "membre", message: "L'argent de poche se tient pour un enfant du foyer." }, 404);
    const ajouter = (hid, mid, type, m, libelle, date) => db.raw.prepare("INSERT INTO poche_mouvements (id, household_id, member_id, date, type, montant, libelle, auto, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)").run(randomUUID(), hid, mid, date, type, c2(signe(type) * m), libelle, new Date().toISOString());
    const auj = () => new Date().toISOString().slice(0, 10);
    /** the child a goal, a chore or a line belongs to (and that it is in this household) */
    const proprietaire = (hid, table, id) => {
        const r = db.raw.prepare(`SELECT * FROM ${table} WHERE id = ? AND household_id = ?`).get(id, hid);
        const m = r && enfants(hid).find((x) => x.id === r.member_id);
        return r && m ? { ligne: r, membre: m } : null;
    };
    /** Every child's kitty, at a glance (the family page). */
    api.get("/poche", (c) => {
        const hid = ctx.household(c).id;
        return c.json({ enfants: enfants(hid).map((m) => { const e = lirePoche(db, hid, m); return { member_id: m.id, prenom: m.prenom, en_place: !!e.reglage || e.mouvements.length > 0, solde: e.solde, disponible: e.disponible, reglage: e.reglage, prochain: e.prochain }; }) });
    });
    api.get("/poche/:membre", (c) => { const m = enfant(c); return m ? c.json(lirePoche(db, ctx.household(c).id, m)) : refus(c); });
    api.put("/poche/:membre/reglage", async (c) => {
        const hid = ctx.household(c).id;
        const m = enfant(c);
        if (!m)
            return refus(c);
        const b = z.object({ montant: z.number().min(0).max(1000), frequence: z.enum(["semaine", "mois"]), jour: z.number().int().min(1).max(28), actif: z.boolean().default(true) }).parse(await c.req.json());
        if (b.frequence === "semaine" && b.jour > 7)
            return c.json({ error: "jour", message: "Choisissez un jour de la semaine." }, 400);
        // the setting applies from today on: days already credited stay as they were
        db.raw.prepare("INSERT INTO poche_reglages (household_id, member_id, montant, frequence, jour, depuis, actif) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(household_id, member_id) DO UPDATE SET montant = excluded.montant, frequence = excluded.frequence, jour = excluded.jour, depuis = excluded.depuis, actif = excluded.actif")
            .run(hid, m.id, c2(b.montant), b.frequence, b.jour, auj(), b.actif && b.montant > 0 ? 1 : 0);
        return c.json(lirePoche(db, hid, m));
    });
    api.post("/poche/:membre/mouvements", async (c) => {
        const hid = ctx.household(c).id;
        const m = enfant(c);
        if (!m)
            return refus(c);
        const b = z.object({ type: z.enum(["depense", "bonus", "retenue"]), montant, libelle: z.string().trim().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(await c.req.json());
        ajouter(hid, m.id, b.type, b.montant, b.libelle, b.date && b.date <= auj() ? b.date : auj());
        return c.json(lirePoche(db, hid, m), 201);
    });
    api.delete("/poche/mouvements/:id", (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_mouvements", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        db.raw.prepare("DELETE FROM poche_mouvements WHERE id = ? AND household_id = ?").run(c.req.param("id"), hid);
        return c.json(lirePoche(db, hid, p.membre));
    });
    // ----- goals: part of the kitty set aside -----
    api.post("/poche/:membre/objectifs", async (c) => {
        const hid = ctx.household(c).id;
        const m = enfant(c);
        if (!m)
            return refus(c);
        const b = z.object({ titre: z.string().trim().min(1).max(60), cible: montant }).parse(await c.req.json());
        db.raw.prepare("INSERT INTO poche_objectifs (id, household_id, member_id, titre, cible, mis_de_cote, cree_le) VALUES (?, ?, ?, ?, ?, 0, ?)").run(randomUUID(), hid, m.id, b.titre, c2(b.cible), new Date().toISOString());
        return c.json(lirePoche(db, hid, m), 201);
    });
    /** Puts money aside for the goal (or takes some back, with a negative amount): only what is available. */
    api.post("/poche/objectifs/:id/mettre", async (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_objectifs", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        const b = z.object({ montant: z.number().min(-10_000).max(10_000) }).parse(await c.req.json());
        const e = lirePoche(db, hid, p.membre);
        const o = p.ligne;
        const voulu = c2(Math.max(0, Math.min(o.cible, o.mis_de_cote + b.montant)));
        const possible = c2(Math.min(voulu, o.mis_de_cote + Math.max(0, e.disponible)));
        if (b.montant > 0 && possible <= o.mis_de_cote)
            return c.json({ error: "disponible", message: `${p.membre.prenom} n'a plus rien de disponible à mettre de côté.` }, 400);
        db.raw.prepare("UPDATE poche_objectifs SET mis_de_cote = ? WHERE id = ?").run(b.montant > 0 ? possible : voulu, o.id);
        return c.json(lirePoche(db, hid, p.membre));
    });
    /** The goal is bought: what was set aside becomes a spending, the goal is closed. */
    api.post("/poche/objectifs/:id/acheter", (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_objectifs", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        const o = p.ligne;
        if (o.mis_de_cote > 0)
            ajouter(hid, p.membre.id, "depense", o.mis_de_cote, o.titre, auj());
        db.raw.prepare("DELETE FROM poche_objectifs WHERE id = ?").run(o.id);
        return c.json(lirePoche(db, hid, p.membre));
    });
    api.delete("/poche/objectifs/:id", (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_objectifs", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        db.raw.prepare("DELETE FROM poche_objectifs WHERE id = ?").run(c.req.param("id")); // what was set aside is available again
        return c.json(lirePoche(db, hid, p.membre));
    });
    // ----- paid chores -----
    api.post("/poche/:membre/missions", async (c) => {
        const hid = ctx.household(c).id;
        const m = enfant(c);
        if (!m)
            return refus(c);
        const b = z.object({ titre: z.string().trim().min(1).max(60), montant }).parse(await c.req.json());
        db.raw.prepare("INSERT INTO poche_missions (id, household_id, member_id, titre, montant, cree_le) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), hid, m.id, b.titre, c2(b.montant), new Date().toISOString());
        return c.json(lirePoche(db, hid, m), 201);
    });
    /** The chore is done: its amount joins the kitty. The chore stays, to be done again. */
    api.post("/poche/missions/:id/payer", (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_missions", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        const mi = p.ligne;
        ajouter(hid, p.membre.id, "mission", mi.montant, mi.titre, auj());
        return c.json(lirePoche(db, hid, p.membre));
    });
    api.delete("/poche/missions/:id", (c) => {
        const hid = ctx.household(c).id;
        const p = proprietaire(hid, "poche_missions", c.req.param("id"));
        if (!p)
            return c.json({ error: "introuvable" }, 404);
        db.raw.prepare("DELETE FROM poche_missions WHERE id = ?").run(c.req.param("id"));
        return c.json(lirePoche(db, hid, p.membre));
    });
}
