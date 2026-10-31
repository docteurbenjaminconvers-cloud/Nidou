import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { donneesFoyer, exporterFoyer } from "./export.js";

/** Reads back the entries of a .zip written by zip.ts (local headers, deflate). */
function lireZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>(); let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const methode = buf.readUInt16LE(i + 8), taille = buf.readUInt32LE(i + 18), lNom = buf.readUInt16LE(i + 26), lExtra = buf.readUInt16LE(i + 28);
    const nom = buf.subarray(i + 30, i + 30 + lNom).toString("utf8"), debut = i + 30 + lNom + lExtra;
    const brut = buf.subarray(debut, debut + taille);
    out.set(nom, (methode === 8 ? inflateRawSync(brut) : brut).toString("utf8"));
    i = debut + taille;
  }
  return out;
}

test("export : tout le foyer dans un .zip, sans aucun code d'accès, et rien des autres foyers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lucien-export-"));
  const db = new Db(":memory:");
  createApi(db, { uploadDir: dir }); // creates every table
  const a = db.createHousehold("Famille A"), b = db.createHousehold("Famille B");
  writeFileSync(join(dir, "facture.pdf"), "%PDF facture");
  db.raw.prepare("INSERT INTO documents (id, household_id, title, category, fichier, mime, confiance, verifie, cree_le, source) VALUES ('d1', ?, 'Facture EDF', 'energie', 'facture.pdf', 'application/pdf', 1, 1, '2026-10-01', 'upload')").run(a.id);
  db.raw.prepare("INSERT INTO documents (id, household_id, title, category, confiance, verifie, cree_le, source) VALUES ('d2', ?, 'Papier de B', 'autre', 1, 1, '2026-10-01', 'upload')").run(b.id);
  db.raw.prepare("INSERT INTO push_subscriptions (id, household_id, endpoint, p256dh, auth, cree_le) VALUES ('p1', ?, 'https://push/x', 'CLEPUSH', 'AUTHPUSH', '2026-10-01')").run(a.id);
  db.raw.prepare("INSERT INTO module_data (household_id, espace, donnees, maj_le) VALUES (?, 'locatif', '{\"biens\":[{\"nom\":\"Studio\"}]}', '2026-10-01')").run(a.id);

  const d = donneesFoyer(db, a.id);
  assert.equal(d.documents.length, 1, "only A's papers");
  assert.deepEqual(d.module_data[0].donnees, { biens: [{ nom: "Studio" }] }, "module data as JSON");
  const z = lireZip(await exporterFoyer(db, a.id, dir));
  assert.ok(z.has("LISEZ-MOI.txt") && z.has("donnees/documents.json") && z.has("donnees/households.json"));
  assert.equal([...z.keys()].find((k) => k.startsWith("papiers/")) && z.get([...z.keys()].find((k) => k.startsWith("papiers/"))!), "%PDF facture", "original file inside");
  const tout = [...z.values()].join("\n");
  const hh = db.getHousehold(a.id)!;
  for (const secret of [hh.mcp_token, "CLEPUSH", "AUTHPUSH"].filter(Boolean)) assert.ok(!tout.includes(secret as string), `secret ${secret} left out`);
  assert.ok(!tout.includes("Papier de B"), "nothing from another household");
});
