import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi } from "./api.js";
import { contenuBail, controlesBail, comparerEdl, edlVide, type DonneesBail } from "./documentsLocation.js";

const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const bail: DonneesBail = {
  meuble: false, bailleur: { nom: "Camille Martin", adresse: "12 rue de la Loge, Montpellier", qualite: "personne_physique" }, locataires: [{ nom: "Inès Morel", email: "ines@example.org" }], solidaires: false,
  logement: { adresse: "4 rue de l'Aiguillerie, 34000 Montpellier", type: "studio", surface: 22, pieces: 1, regime_juridique: "copropriete", chauffage: "individuel", eau_chaude: "individuelle", dpe: "D" },
  debut: "2026-12-01", duree_mois: 36, loyer_hc: 520, charges: 35, charges_mode: "provision", jour_paiement: 5, irl_trimestre: 2, depot_garantie: 520,
};

test("bail : contrôles légaux (dépôt, durée, forfait, DPE G)", () => {
  assert.deepEqual(controlesBail(bail), []);
  const a = controlesBail({ ...bail, depot_garantie: 1100, duree_mois: 12, charges_mode: "forfait", logement: { ...bail.logement, dpe: "G" } });
  assert.equal(a.length, 4, a.join(" | "));
  assert.equal(controlesBail({ ...bail, meuble: true, depot_garantie: 1040, duree_mois: 12 }).length, 0, "furnished: two months, one year");
  const c = contenuBail({ ...bail, locataires: [{ nom: "A" }, { nom: "B" }], solidaires: true });
  assert.ok(c.sections.some((s) => s.titre.includes("solidarité")));
  assert.ok(c.sections.some((s) => s.titre.includes("Clause résolutoire")));
});

test("état des lieux de sortie : dégradations comparées à l'entrée", () => {
  const base = { date: "2026-12-01", bailleur: "C", locataires: ["I"], adresse: "x", meuble: false, typeBien: "appartement", pieces: 2 };
  const e = edlVide("entree", base), s = edlVide("sortie", base);
  e.pieces[1].elements[0].etat = "bon"; s.pieces[1].elements[0].etat = "mauvais"; s.pieces[1].elements[0].commentaire = "parquet rayé";
  e.pieces[1].elements[1].etat = "bon"; s.pieces[1].elements[1].etat = "bon";
  assert.deepEqual(comparerEdl(e, s).map((x) => [x.piece, x.element, x.apres]), [["Séjour", "Sol", "mauvais"]]);
});

test("signature en ligne : texte figé, lien personnel du locataire, PDF signé rangé dans les papiers", async () => {
  process.env.LUCIEN_AUTH = "0"; delete process.env.BREVO_API_KEY;
  const db = new Db(":memory:");
  const h = seedDemo(db, { espaces: true });
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const cree = await (await api.request("/locatif/documents", json({ type: "bail", bien_id: "b1", donnees: bail }))).json();
  assert.equal(cree.statut, "brouillon");
  assert.equal((await api.request(`/locatif/documents/${cree.id}`, json({ donnees: { ...bail, loyer_hc: 530 } }, "PUT"))).status, 200, "a draft can be edited");
  const env = await (await api.request(`/locatif/documents/${cree.id}/envoyer`, json({ envoyer_email: false }))).json();
  assert.equal(env.statut, "a_signer"); assert.equal(env.liens.length, 1);
  assert.equal((await api.request(`/locatif/documents/${cree.id}`, json({ donnees: bail }, "PUT"))).status, 409, "frozen once sent");
  const jeton = env.liens[0].lien.split("/signer/")[1];
  const pub = await (await api.request(`/signature/p/${jeton}`)).json();
  assert.equal(pub.moi.nom, "Inès Morel"); assert.ok(pub.sections.some((s: { paragraphes: string[] }) => s.paragraphes.some((p) => p.includes("530,00 €"))));
  assert.equal((await api.request(`/signature/p/${jeton}/signer`, json({ image: PNG, accepte: true, empreinte: "autre" }))).status, 409, "signing another text is refused");
  assert.equal((await api.request(`/signature/p/${jeton}/signer`, json({ image: PNG, accepte: true, empreinte: pub.empreinte }))).status, 200);
  assert.equal((await api.request(`/signature/p/${jeton}/signer`, json({ image: PNG, accepte: true, empreinte: pub.empreinte }))).status, 409, "only once");
  assert.equal((await api.request("/signature/p/faux-jeton")).status, 404);
  const fini = await (await api.request(`/locatif/documents/${cree.id}/signer`, json({ image: PNG, accepte: true }))).json();
  assert.equal(fini.statut, "signe"); assert.ok(fini.document_id);
  const papier = db.getDocument(fini.document_id)!;
  assert.equal(papier.household_id, h.id); assert.equal(papier.mime, "application/pdf"); assert.equal(papier.category, "logement");
  const pdf = await api.request(`/signature/p/${jeton}/pdf`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.ok((await pdf.text()).startsWith("%PDF"), "the tenant downloads the signed PDF");
  assert.equal((await api.request(`/locatif/documents/${cree.id}`, { method: "DELETE" })).status, 409, "a signed lease is kept");
});
