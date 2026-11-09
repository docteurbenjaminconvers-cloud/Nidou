import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien, oublierDemandes } from "./auth.js";
import { ecrireFichier, initCoffre } from "./coffre.js";

test("coffre-fort : identité fermée par défaut, ouverte par un code email pour 10 minutes, chaque ouverture notée", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "1"; oublierDemandes();
  const data = mkdtempSync(join(tmpdir(), "coffre-api-")), up = join(data, "uploads");
  initCoffre(data);
  const log = console.log; const vus: string[] = []; console.log = (...a: unknown[]) => { vus.push(a.join(" ")); };
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: up });
    const r = await demanderLien(db, "claire@x.fr", { prenom: "Claire" });
    const s = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15); assert.ok(s.ok);
    const ck = { cookie: `lucien_session=${s.ok ? s.session : ""}`, "content-type": "application/json" };
    const hid = s.ok ? s.household.id : "";
    (await import("node:fs")).mkdirSync(up, { recursive: true });
    await ecrireFichier(join(up, "passeport.pdf"), Buffer.from("%PDF passeport"));
    const vide = { member_id: null, organisme: null, montant: null, periodicite: null, date_document: null, date_debut: null, date_fin: null, preavis_jours: null, resume: null, texte: null, fichier: null, mime: null, confiance: 1 };
    const passeport = db.insertDocument({ ...vide, household_id: hid, title: "Passeport — Claire", category: "identite", numero_contrat: "21FR88213456", fichier: "passeport.pdf", mime: "application/pdf", texte: "NOM CLAIRE né le…" } as any);
    const facture = db.insertDocument({ ...vide, household_id: hid, title: "Facture Orange", category: "telecom", numero_contrat: "CLIENT-778" } as any);

    const liste = await (await api.request("/documents", { headers: ck })).json() as any[];
    const p = liste.find((d) => d.id === passeport.id), f = liste.find((d) => d.id === facture.id);
    assert.equal(p.numero_contrat, "•••• 3456"); assert.equal(p.verrouille, true);
    assert.equal(f.numero_contrat, "CLIENT-778", "the other papers stay as they are");
    assert.equal((await (await api.request(`/documents/${passeport.id}`, { headers: ck })).json() as any).texte, null);
    assert.equal((await api.request(`/documents/${passeport.id}/fichier`, { headers: ck })).status, 423);
    assert.equal((await api.request("/export.zip", { headers: ck })).status, 423, "the export holds the coffre too");

    // code by email: a wrong code, then the right one
    assert.equal((await api.request("/coffre/code", { method: "POST", headers: ck })).status, 200);
    const code = vus.join("\n").match(/(\d{6}) : votre code pour ouvrir le coffre/)![1];
    assert.equal((await api.request("/coffre/code/verifier", { method: "POST", headers: ck, body: JSON.stringify({ code: code === "000000" ? "111111" : "000000" }) })).status, 400);
    assert.equal((await api.request("/coffre/code/verifier", { method: "POST", headers: ck, body: JSON.stringify({ code }) })).status, 200);

    const ouvert = await (await api.request(`/documents/${passeport.id}`, { headers: ck })).json() as any;
    assert.equal(ouvert.numero_contrat, "21FR88213456"); assert.equal(ouvert.verrouille, false);
    const fichier = await api.request(`/documents/${passeport.id}/fichier`, { headers: ck });
    assert.equal(fichier.status, 200); assert.equal(Buffer.from(await fichier.arrayBuffer()).toString(), "%PDF passeport", "decrypted for the household");
    // a masked number sent back by a form never overwrites the real one
    await api.request(`/documents/${passeport.id}`, { method: "PATCH", headers: ck, body: JSON.stringify({ numero_contrat: "•••• 3456" }) });
    assert.equal(db.getDocument(passeport.id)!.numero_contrat, "21FR88213456");
    const journal = await (await api.request("/coffre/journal", { headers: ck })).json() as any[];
    assert.ok(journal.some((j) => j.action.startsWith("ouverture du coffre")));
    assert.ok(journal.some((j) => j.action === "fichier ouvert" && j.titre === "Passeport — Claire"));
    // closed again
    await api.request("/coffre/fermer", { method: "POST", headers: ck });
    assert.equal((await api.request(`/documents/${passeport.id}/fichier`, { headers: ck })).status, 423);
  } finally { console.log = log; process.env.LUCIEN_AUTH = avant; }
});
