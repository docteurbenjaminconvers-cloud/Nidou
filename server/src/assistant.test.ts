import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { ASSISTANT, AssistantErreur, coutCentimes, ensureAssistantSchema, etatAssistant, repondre, setOption } from "./assistant.js";

/** A scripted model: each call returns the next scripted turn and records what it was sent. */
function fauxModele(tours: ((req: any) => any)[]) {
  const recus: any[] = [];
  let i = 0;
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 };
  return {
    recus,
    client: { messages: { create: async (req: any) => { recus.push(structuredClone(req)); const t = tours[Math.min(i++, tours.length - 1)](req); return { usage, ...t }; } } } as any,
  };
}

function foyer() {
  const db = new Db(":memory:");
  ensureAssistantSchema(db);
  seedDemo(db);
  const h = db.firstHousehold()!;
  return { db, h };
}

test("assistant : accès selon le plan et l'option", () => {
  const { db, h } = foyer();
  assert.equal(etatAssistant(db, h).acces, "essai", "pendant l'essai : quelques questions pour goûter");
  assert.equal(etatAssistant(db, h).quota, ASSISTANT.questionsEssai);
  db.setPlan(h.id, "famille");
  assert.equal(etatAssistant(db, db.getHousehold(h.id)!).acces, "aucun", "formule sans l'option");
  setOption(db, h.id, true);
  const e = etatAssistant(db, db.getHousehold(h.id)!);
  assert.equal(e.acces, "option");
  assert.equal(e.quota, ASSISTANT.questionsMois);
});

test("assistant : interroge les outils du connecteur, prépare un courrier, compte la question une fois", async () => {
  const { db, h } = foyer();
  db.setPlan(h.id, "famille");
  setOption(db, h.id, true);
  const auto = db.listDocuments(h.id).find((d) => d.title.startsWith("Assurance auto"))!;
  const m = fauxModele([
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "rechercher", input: { q: "Peugeot" } }] }),
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "preparer_courrier", input: { document_id: auto.id, type: "resiliation" } }] }),
    () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Voici le courrier : complétez votre adresse." }] }),
  ]);
  const r = await repondre(db, db.getHousehold(h.id)!, [{ role: "user", content: "Résilie mon assurance auto" }], { nom: "Camille" }, m.client);
  assert.match(r.reponse, /courrier/);
  assert.ok(r.courrier && r.courrier.texte.includes("AUT-4471-8820") && r.courrier.texte.includes("Camille"), "le courrier reprend le numéro de contrat et le nom");
  assert.ok(r.liens.some((l) => l.id === auto.id), "le contrat concerné est proposé en lien");
  assert.ok(r.liens.length <= 4);
  // tools offered = connector tools + the letter tool, system prompt and tools cached
  const outils = m.recus[0].tools.map((t: any) => t.name);
  for (const n of ["lister_documents", "echeances", "charges_fixes", "rechercher", "preparer_courrier"]) assert.ok(outils.includes(n), n);
  assert.ok(m.recus[0].system[0].cache_control && m.recus[0].tools.at(-1).cache_control);
  // the tool result really came from the household's papers
  const resultat = m.recus[1].messages.at(-1).content[0].content as string;
  assert.match(resultat, /Peugeot 3008/);
  const e = etatAssistant(db, db.getHousehold(h.id)!);
  assert.equal(e.utilisees, 1, "une question, quel que soit le nombre d'appels");
  assert.equal(r.etat.utilisees, 1);
  assert.ok(db.listMcpAccess(h.id).some((l: any) => l.outil === "rechercher"), "journalisé comme le connecteur");
});

test("assistant : refuse sans option, au-delà du quota, et coûte une fraction de centime", async () => {
  const { db, h } = foyer();
  db.setPlan(h.id, "famille");
  const m = fauxModele([() => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] })]);
  await assert.rejects(repondre(db, db.getHousehold(h.id)!, [{ role: "user", content: "?" }], {}, m.client), (e) => e instanceof AssistantErreur && e.code === "acces");
  setOption(db, h.id, true);
  db.raw.prepare("INSERT INTO assistant_usage (household_id, mois, questions, centimes) VALUES (?, ?, ?, 0)").run(h.id, new Date().toISOString().slice(0, 7), ASSISTANT.questionsMois);
  await assert.rejects(repondre(db, db.getHousehold(h.id)!, [{ role: "user", content: "?" }], {}, m.client), (e) => e instanceof AssistantErreur && e.code === "quota");
  // 1 000 tokens in, 200 out, 3 000 cache reads with Haiku 5.5 ≈ 0,02 centime
  const c = coutCentimes({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000 });
  assert.ok(c > 0.015 && c < 0.025, String(c));
});

test("assistant : connaît le mode d'emploi et ouvre le bon écran", async () => {
  const { db, h } = foyer();
  const m = fauxModele([
    () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "e1", name: "ouvrir_ecran", input: { ecran: "add" } }] }),
    () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Touchez le bouton + au centre." }] }),
  ]);
  const r = await repondre(db, h, [{ role: "user", content: "Comment j'ajoute un papier ?" }], {}, m.client);
  assert.deepEqual(r.liens, [{ type: "ecran", id: "add", titre: "Ajouter un papier" }]);
  const sys = m.recus[0].system[0].text as string;
  assert.match(sys, /bouton \+ au centre/);
  assert.match(sys, /Duo \(jusqu'à 2 personnes\) 9,90 € par mois/);
});
