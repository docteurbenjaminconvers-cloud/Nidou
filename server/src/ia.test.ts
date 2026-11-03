import { test } from "node:test";
import assert from "node:assert/strict";
import { structured } from "./ia.js";

test("IA : un modèle qui refuse le choix d'outil forcé répond quand même (outil demandé dans les consignes)", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test"; process.env.LUCIEN_IA_PROVIDER = "anthropic";
  const vieux = globalThis.fetch;
  const corps: { tool_choice?: { type: string } }[] = [];
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init!.body)); corps.push(b);
    if (b.tool_choice?.type === "tool") return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "tool_choice: type \"tool\" and \"any\" are not supported for this model." } }), { status: 400, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: b.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "tool_use", id: "t", name: "bail", input: { loyer_hc: 750 } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const call = { tier: "precis" as const, system: "Lis le bail.", content: [{ type: "text" as const, text: "Loyer 750 €" }], tool: { name: "bail", description: "Champs", schema: { type: "object", properties: {} } } };
    const r = await structured(call);
    assert.deepEqual(r.data, { loyer_hc: 750 });
    assert.equal(corps.length, 2);
    await structured(call);
    assert.equal(corps.length, 3, "the model is remembered: no failing call the second time");
    assert.equal(corps[2].tool_choice?.type, "auto");
  } finally { globalThis.fetch = vieux; delete process.env.ANTHROPIC_API_KEY; delete process.env.LUCIEN_IA_PROVIDER; }
});
