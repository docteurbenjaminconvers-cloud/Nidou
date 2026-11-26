import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { anonymiser, chercherMoinsCher, comparable, derniereRecherche, encoreValable, ensureObservatoireSchema, garderRecherche, lireReponse, mensuelDe, recherchesDuMois, type Creer } from "./observatoire.js";
import { centimesReels } from "./ia.js";

const doc = { id: "d1", household_id: "h", title: "Freebox Pop — Free", category: "telecom", organisme: "Free", montant: 39.99, periodicite: "mensuel", date_fin: null, resume: "Box fibre 5 Gb/s, client n° 123456789", texte: "Contact : jean@exemple.fr IBAN FR76 3000 6000 0112 3456 7890 189 — Freebox Pop fibre", details: null } as any;

const resultats = { type: "web_search_tool_result", tool_use_id: "s1", content: [
  { type: "web_search_result", url: "https://www.sosh.fr/box-internet", title: "La Boîte Sosh Fibre" },
  { type: "web_search_result", url: "https://www.red-by-sfr.fr/box-internet/", title: "RED Box" },
] };
const reponse = (json: unknown) => [{ type: "server_tool_use", name: "web_search" }, resultats, { type: "text", text: "Voici.\n```json\n" + JSON.stringify(json) + "\n```" }];

test("observatoire : seules les offres lues dans la recherche sont gardées, l'économie est recalculée ici", () => {
  const r = lireReponse(reponse({ resume: "Vous payez plus que le marché.", reference: null, offres: [
    { fournisseur: "RED", offre: "RED Box Fibre", prix_mensuel: 24.99, prix_detail: "24,99 €/mois sans engagement", conditions: "Sans engagement", url: "https://www.red-by-sfr.fr/box-internet/" },
    { fournisseur: "Inventé", offre: "Offre fantôme", prix_mensuel: 5, prix_detail: "5 €", conditions: "", url: "https://arnaque.example/offre" },
    { fournisseur: "Sosh", offre: "Boîte Sosh", prix_mensuel: 25.99, prix_detail: "25,99 €/mois", conditions: "", url: "https://sosh.fr/box-internet?x=1" },
    { fournisseur: "Cher", offre: "Plus cher", prix_mensuel: 49.99, prix_detail: "", conditions: "", url: "https://www.sosh.fr/autre" },
  ] }), 39.99)!;
  assert.deepEqual(r.offres.map((o) => o.fournisseur), ["RED", "Sosh", "Cher"], "the link that is not from the search is dropped");
  assert.equal(r.offres[0].economie_annuelle, 180); assert.equal(r.offres[2].economie_annuelle, null);
  assert.equal(r.offres[0].site, "red-by-sfr.fr"); assert.equal(r.sources[0].url, "https://www.red-by-sfr.fr/box-internet/");
  assert.equal(lireReponse([{ type: "text", text: "pas de json" }], 10), null);
});

test("observatoire : recherche complète (reprise après pause), rien de nominatif n'est envoyé, gardée 30 jours et comptée", async () => {
  const avant = { p: process.env.LUCIEN_IA, k: process.env.ANTHROPIC_API_KEY }; process.env.ANTHROPIC_API_KEY = "sk-test"; delete process.env.LUCIEN_IA;
  try {
    assert.ok(comparable(doc)); assert.ok(!comparable({ category: "impots", montant: 10 })); assert.ok(!comparable({ category: "energie", montant: null }));
    assert.equal(mensuelDe({ montant: 600, periodicite: "annuel" }), 50);
    assert.doesNotMatch(anonymiser(doc.texte + " " + doc.resume), /jean@|3000 6000|123456789/);
    const appels: any[] = [];
    const creer: Creer = async (p) => { appels.push(p); return appels.length === 1 ? { content: [{ type: "server_tool_use", name: "web_search" } as any], stop_reason: "pause_turn" } : { content: reponse({ resume: "Moins cher ailleurs.", reference: null, offres: [{ fournisseur: "RED", offre: "RED Box", prix_mensuel: 24.99, prix_detail: "24,99 €", conditions: "", url: "https://www.red-by-sfr.fr/box-internet/" }] }) as any, stop_reason: "end_turn" }; };
    const r = await chercherMoinsCher(doc, { creer, aujourdhui: "2026-11-26" });
    assert.equal(appels.length, 2); assert.equal(appels[1].messages.length, 2, "the paused turn is sent back");
    assert.equal(appels[0].tools[0].type, "web_search_20250305"); assert.equal(appels[0].tools[0].max_uses, 4);
    assert.doesNotMatch(JSON.stringify(appels[0].messages), /jean@exemple|123456789/);
    assert.equal(r.offres.length, 1); assert.equal(r.paye_mensuel, 39.99); assert.match(r.prudence!, /éligibilité/);
    await assert.rejects(chercherMoinsCher(doc, { creer: async () => ({ content: [{ type: "text", text: "rien" } as any], stop_reason: "end_turn" }) }), /recherche_vide/);
    const db = new Db(":memory:"); ensureObservatoireSchema(db);
    const g = garderRecherche(db, "h", r, 9.5);
    assert.equal(derniereRecherche(db, "h", "d1")!.id, g.id); assert.equal(recherchesDuMois(db, "h"), 1); assert.equal(recherchesDuMois(db, "autre"), 0);
    assert.ok(encoreValable(g)); assert.ok(!encoreValable(g, Date.now() + 31 * 86400_000));
    // a web search is billed on top of the tokens
    const sans = centimesReels("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 100 });
    assert.ok(Math.abs(centimesReels("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 4 } }) - sans - 4 * 0.92) < 1e-9);
  } finally { if (avant.k) process.env.ANTHROPIC_API_KEY = avant.k; else delete process.env.ANTHROPIC_API_KEY; if (avant.p) process.env.LUCIEN_IA = avant.p; }
});
