import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chiffrer, chiffrerExistants, dechiffrer, ecrireFichier, estChiffre, initCoffre, lireFichier } from "./coffre.js";

test("coffre : les fichiers sont chiffrés sur le disque, relus en clair, liés à leur nom ; les anciens restent lisibles", async () => {
  const data = mkdtempSync(join(tmpdir(), "coffre-")), dir = join(data, "uploads");
  (await import("node:fs")).mkdirSync(dir);
  delete process.env.LUCIEN_CLE_COFFRE;
  initCoffre(data);
  const p = join(dir, "passeport.pdf"), clair = Buffer.from("%PDF passeport de Léa");
  await ecrireFichier(p, clair);
  const disque = readFileSync(p);
  assert.ok(estChiffre(disque)); assert.ok(!disque.includes(Buffer.from("passeport de")), "nothing in clear on the disk");
  assert.deepEqual(await lireFichier(p), clair);
  assert.throws(() => dechiffrer(join(dir, "autre.pdf"), disque), "a file cannot be passed off as another");
  const ancien = join(dir, "ancien.jpg"); writeFileSync(ancien, "photo d'avant");
  assert.equal((await lireFichier(ancien)).toString(), "photo d'avant", "files written before encryption are still read");

  // the server key is set later: new files use it, files written with the disk key stay readable
  process.env.LUCIEN_CLE_COFFRE = "une-cle-de-serveur-assez-longue";
  initCoffre(data);
  assert.deepEqual(await lireFichier(p), clair);
  const nouveau = chiffrer("x.pdf", Buffer.from("x"));
  assert.ok(!nouveau.subarray(8, 16).equals(disque.subarray(8, 16)), "another key");
  // the old files are encrypted in place on request, and read back
  const r = await chiffrerExistants(dir);
  assert.deepEqual(r, { chiffres: 1, deja: 1 });
  assert.equal((await lireFichier(ancien)).toString(), "photo d'avant");
  delete process.env.LUCIEN_CLE_COFFRE;
});
