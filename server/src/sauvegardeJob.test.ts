import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dechiffrer, lireTar } from "./sauvegarde.js";
import { derniereSauvegarde, faireSauvegarde } from "./sauvegardeJob.js";

test("sauvegarde du jour : base, papiers et clé du coffre dans une archive chiffrée, envoyée hors du serveur, relisible", async () => {
  const data = mkdtempSync(join(tmpdir(), "lucien-bk-"));
  const db = new DatabaseSync(join(data, "lucien.sqlite")); db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('bonjour')"); db.close();
  mkdirSync(join(data, "uploads")); writeFileSync(join(data, "uploads", "a.pdf"), "LUCIENC1…chiffré"); writeFileSync(join(data, "cle-coffre"), "cle-du-disque");
  const cle = "une longue phrase secrète de test";
  const envois: { url: string; octets: number }[] = [];
  const faux = (async (url: string | URL | Request, init?: RequestInit) => { envois.push({ url: String(url), octets: (init?.body as Uint8Array).length }); return new Response("", { status: 200 }); }) as typeof fetch;
  const s3 = { endpoint: "https://s3.fr-par.scw.cloud", region: "fr-par", bucket: "lucien-sauvegardes", accessKey: "AK", secretKey: "SK" };
  for (const j of [1, 2, 3]) await faireSauvegarde({ data, cle, s3, garder: 2, fetchImpl: faux, maintenant: new Date(`2026-11-0${j}T03:00:00Z`) });
  const out = join(data, "sauvegardes");
  assert.deepEqual(readdirSync(out).sort(), ["2026-11-02T03-00-00.lucienbk", "2026-11-03T03-00-00.lucienbk"], "two kept, no clear folder left");
  assert.equal(envois.length, 3); assert.match(envois[2].url, /lucien-sauvegardes.*lucien\/2026-11-03T03-00-00\.lucienbk$/);
  const fichiers = lireTar(dechiffrer(readFileSync(join(out, "2026-11-03T03-00-00.lucienbk")), cle));
  assert.deepEqual(fichiers.map((f) => f.nom).sort(), ["cle-coffre", "lucien.sqlite", "uploads/a.pdf"]);
  assert.equal(derniereSauvegarde(out)?.toISOString(), "2026-11-03T03:00:00.000Z");
  assert.throws(() => dechiffrer(readFileSync(join(out, "2026-11-03T03-00-00.lucienbk")), "mauvaise phrase secrète !!"));
  await assert.rejects(faireSauvegarde({ data, cle: "", s3, fetchImpl: faux }), /sans chiffrement/, "never sent in clear");
});
