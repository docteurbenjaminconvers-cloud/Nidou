import { test } from "node:test";
import assert from "node:assert/strict";
import { structured, text } from "./ia.js";

type Corps = { model: string; tool_choice?: { type: string }; thinking?: { type: string }; output_config?: { effort: string }; max_tokens: number; temperature?: number; system?: string };
const reponse = (b: Corps, contenu: unknown[]) => new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, content: contenu }), { status: 200, headers: { "content-type": "application/json" } });
const erreur = (message: string) => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }), { status: 400, headers: { "content-type": "application/json" } });
const call = { tier: "precis" as const, system: "Lis le bail.", content: [{ type: "text" as const, text: "Loyer 750 €" }], tool: { name: "bail", description: "Champs", schema: { type: "object", properties: {} } } };

test("IA, modèles 5.5 : pas de choix d'outil forcé, réflexion légère, marge dans max_tokens, pas de température", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test"; process.env.LUCIEN_IA_PROVIDER = "anthropic"; process.env.LUCIEN_MODEL_PRECIS = "claude-sonnet-5-5";
  const vieux = globalThis.fetch; const corps: Corps[] = [];
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body)) as Corps; corps.push(b);
    if (b.tool_choice?.type === "tool" || b.tool_choice?.type === "any") return erreur('tool_choice: type "tool" and "any" are not supported for this model.');
    if (b.temperature !== undefined) return erreur("temperature is not supported");
    return reponse(b, [{ type: "thinking", thinking: "…", signature: "s" }, { type: "tool_use", id: "t", name: "bail", input: { loyer_hc: 750 } }]);
  }) as typeof fetch;
  try {
    const r = await structured(call);
    assert.deepEqual(r.data, { loyer_hc: 750 });
    assert.equal(corps.length, 1, "first try is the right one");
    assert.equal(corps[0].tool_choice?.type, "auto");
    assert.match(corps[0].system!, /appelant l'outil « bail »/);
    assert.equal(corps[0].thinking?.type, "between_tools");
    assert.equal(corps[0].output_config?.effort, "low");
    assert.ok(corps[0].max_tokens >= 4096);
  } finally { globalThis.fetch = vieux; }
});

test("IA : un ancien modèle qui refuse le choix forcé est mémorisé ; un réglage refusé est retiré", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test"; process.env.LUCIEN_IA_PROVIDER = "anthropic"; process.env.LUCIEN_MODEL_PRECIS = "claude-futur-x";
  const vieux = globalThis.fetch; const corps: Corps[] = [];
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body)) as Corps; corps.push(b);
    if (b.tool_choice?.type === "tool") return erreur('tool_choice: type "tool" and "any" are not supported for this model.');
    return reponse(b, [{ type: "tool_use", id: "t", name: "bail", input: { ok: true } }]);
  }) as typeof fetch;
  try {
    await structured(call); await structured(call);
    assert.equal(corps.length, 3, "one failed call only, then remembered");
    assert.equal(corps[2].tool_choice?.type, "auto");
    // a 5.5 model refusing the thinking settings: retried without them
    process.env.LUCIEN_MODEL_RAPIDE = "claude-haiku-5-5";
    corps.length = 0;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as Corps; corps.push(b);
      if (b.output_config) return erreur("output_config.effort is not supported for this model");
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Bonjour" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    assert.equal(await text({ tier: "rapide", system: "s", prompt: "p" }), "Bonjour");
    assert.equal(corps.length, 2);
    assert.equal(corps[1].output_config, undefined);
  } finally { globalThis.fetch = vieux; delete process.env.ANTHROPIC_API_KEY; delete process.env.LUCIEN_IA_PROVIDER; delete process.env.LUCIEN_MODEL_PRECIS; delete process.env.LUCIEN_MODEL_RAPIDE; }
});
