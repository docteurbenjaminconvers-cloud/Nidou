import { test } from "node:test";
import assert from "node:assert/strict";
import { chiffrer, dechiffrer, envoyerS3, lireTar, signerV4, tar } from "./sauvegarde.js";

test("sauvegarde : archive tar aller-retour, noms longs et fichiers binaires compris", () => {
  const long = `uploads/${"dossier-".repeat(15)}/papier.pdf`;
  const entrees = [{ nom: "lucien.sqlite", contenu: Buffer.from("SQLite format 3\0" + "x".repeat(1000)) }, { nom: long, contenu: Buffer.from([0, 255, 1, 2]) }, { nom: "vide.txt", contenu: Buffer.alloc(0) }];
  const lu = lireTar(tar(entrees));
  assert.deepEqual(lu.map((e) => e.nom), entrees.map((e) => e.nom));
  for (let i = 0; i < entrees.length; i++) assert.ok(lu[i].contenu.equals(entrees[i].contenu));
});

test("sauvegarde : chiffrée, illisible sans la bonne clé", () => {
  const cle = "une phrase secrète assez longue pour Lucien";
  const donnees = Buffer.from("données du foyer : papiers, banque");
  const f = chiffrer(donnees, cle);
  assert.ok(!f.includes(Buffer.from("papiers")), "nothing readable inside");
  assert.ok(dechiffrer(f, cle).equals(donnees));
  assert.throws(() => dechiffrer(f, "une autre phrase secrète assez longue"), /Clé incorrecte/);
  assert.throws(() => chiffrer(donnees, "courte"), /trop courte/);
  const abime = Buffer.from(f); abime[abime.length - 1] ^= 1;
  assert.throws(() => dechiffrer(abime, cle), /abîmée/, "tampering detected");
});

test("sauvegarde : signature S3 conforme à l'exemple officiel AWS (GET Object)", () => {
  const h = signerV4({
    method: "GET", host: "examplebucket.s3.amazonaws.com", chemin: "/test.txt", region: "us-east-1",
    accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    hashCorps: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", date: new Date("2013-05-24T00:00:00Z"), entetes: { range: "bytes=0-9" },
  });
  assert.equal(h.authorization, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("sauvegarde : envoi vers le stockage, erreur claire si refusé", async () => {
  const vus: { url: string; method?: string; auth?: string }[] = [];
  const ok = (async (url: URL, init: RequestInit) => { vus.push({ url: String(url), method: init.method, auth: (init.headers as Record<string, string>).authorization }); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
  const cfg = { endpoint: "https://s3.gra.io.cloud.ovh.net", region: "gra", bucket: "lucien-sauvegardes", accessKey: "AK", secretKey: "SK" };
  await envoyerS3(cfg, "2026/10/31.lucienbk", Buffer.from("x"), ok);
  assert.equal(vus[0].url, "https://s3.gra.io.cloud.ovh.net/lucien-sauvegardes/2026/10/31.lucienbk");
  assert.equal(vus[0].method, "PUT"); assert.match(vus[0].auth!, /^AWS4-HMAC-SHA256 Credential=AK\//);
  const refuse = (async () => new Response("AccessDenied", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(envoyerS3(cfg, "x", Buffer.from("x"), refuse), /refusé par le stockage : 403/);
});
