import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { appliquerBail, appliquerBulletin, lireBailLocal, lireBulletinLocal } from "./lecture.js";

const BULLETIN = `ATELIER VERDIER SAS — Bulletin de paie
Période : juin 2026
Salaire brut  3 650,00
Net imposable 2 921,40
NET À PAYER AVANT IMPÔT 2 850,12
Net à payer 2 712,55
Contrat : CDI`;
const BAIL = `CONTRAT DE LOCATION — logement meublé (appartement)
Surface habitable : 42 m²
Le présent bail prend effet le 01/09/2026.
Loyer mensuel hors charges : 850,00 euros
Provision sur charges : 60,00 euros
Dépôt de garantie : 1 700,00 euros
Classe énergie : D`;

test("lecture sans IA : un bulletin de salaire", () => {
  const b = lireBulletinLocal(BULLETIN);
  assert.equal(b.mois, "2026-06"); assert.equal(b.brut, 3650); assert.equal(b.net_imposable, 2921.4);
  assert.equal(b.net_paye, 2850.12, "the first « net à payer » line"); assert.equal(b.type_contrat, "CDI");
});

test("lecture sans IA : un bail", () => {
  const l = lireBailLocal(BAIL);
  assert.equal(l.loyer_hc, 850); assert.equal(l.charges, 60); assert.equal(l.depot_garantie, 1700);
  assert.equal(l.debut, "2026-09-01"); assert.equal(l.meuble, true); assert.equal(l.surface, 42); assert.equal(l.dpe, "D");
});

test("remplissage : bulletin ajouté ou remplacé pour le mois, bail sur un bien neuf ou existant", () => {
  const lu = { ...lireBulletinLocal(BULLETIN), employeur: "Atelier Verdier" };
  const r1 = appliquerBulletin({ personnes: [] }, { member_id: "m1", prenom: "Camille" }, lu);
  assert.equal(r1.donnees.personnes[0].salarie!.employeur, "Atelier Verdier");
  const r2 = appliquerBulletin(r1.donnees, { member_id: "m1", prenom: "Camille" }, { ...lu, net_paye: 2800 });
  assert.equal(r2.donnees.personnes[0].salarie!.bulletins.length, 1, "same month replaced");
  assert.match(r2.resume, /juin 2026.*2\s?800/);
  assert.throws(() => appliquerBulletin({ personnes: [] }, { member_id: null, prenom: "Moi" }, { ...lu, mois: null }), /à la main/);
  const b = appliquerBail({ bailleur: "", biens: [], baux: [] }, { ...lireBailLocal(BAIL), locataire: "Hugo Fabre", adresse: "12 rue Foch, Montpellier" });
  assert.equal(b.donnees.biens[0].meuble, true); assert.equal(b.donnees.biens[0].dpe, "D");
  assert.equal(b.donnees.baux[0].irl_trimestre, 3, "September → 3rd quarter"); assert.equal(b.donnees.baux[0].loyer_hc, 850);
  const b2 = appliquerBail(b.donnees, { ...lireBailLocal(BAIL), debut: "2027-09-01", locataire: "Inès Morel" }, b.bien_id);
  assert.equal(b2.donnees.biens.length, 1); assert.equal(b2.donnees.baux[0].fin, "2027-09-01", "previous lease ended");
});

test("remplissage par l'appli : bulletin lu, espace rempli, papier gardé ; module exigé", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const dir = mkdtempSync(join(tmpdir(), "lucien-lire-"));
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: dir });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const form = new FormData();
    form.append("file", new File([BULLETIN], "bulletin-juin.txt", { type: "text/plain" }));
    const r = await api.request("/espaces/pro/lire", { method: "POST", body: form });
    assert.equal(r.status, 200, await r.clone().text());
    assert.match((await r.json()).resume, /juin 2026/);
    const esp = await (await api.request("/espaces/pro")).json();
    assert.ok(esp.donnees.personnes.some((p: { salarie: { bulletins: unknown[] } | null }) => p.salarie?.bulletins.length === 1));
    assert.ok(db.listDocuments(h.id).some((d) => /Bulletin de salaire juin 2026/.test(d.title)), "original kept in Papiers");
    assert.equal(readdirSync(dir).length, 1);
    const bail = new FormData(); bail.append("file", new File([BAIL], "bail.txt", { type: "text/plain" }));
    assert.equal((await api.request("/espaces/locatif/lire", { method: "POST", body: bail })).status, 200);
    // after the trial, without the module: refused
    db.setTrialEnd(h.id, new Date(0).toISOString());
    const f2 = new FormData(); f2.append("file", new File([BULLETIN], "b.txt", { type: "text/plain" }));
    assert.equal((await api.request("/espaces/pro/lire", { method: "POST", body: f2 })).status, 402);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
