import { test } from "node:test";
import assert from "node:assert/strict";
import { avecCompteur, centimesReels, reel } from "./ia.js";

test("coût réel d'un appel : tarifs Anthropic par jeton, Haiku ×5 au-delà de 100 000 jetons d'entrée", () => {
  process.env.LUCIEN_USD_EUR = "1";
  // Haiku 5.5: 0,10 $ / 0,50 $ per million → 10 000 in + 2 000 out = 0,001 + 0,001 $ = 0,2 centime
  assert.equal(Number(centimesReels("claude-haiku-5-5", { input_tokens: 10_000, output_tokens: 2_000 }).toFixed(4)), 0.2);
  // over 100 000 input tokens: five times the price
  assert.equal(Number(centimesReels("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 }).toFixed(4)), 10);
  // Sonnet 5.5: 2 $ / 10 $ per million → 3 000 in + 1 500 out = 0,006 + 0,015 $ = 2,1 centimes
  assert.equal(Number(centimesReels("claude-sonnet-5-5", { input_tokens: 3_000, output_tokens: 1_500 }).toFixed(4)), 2.1);
  delete process.env.LUCIEN_USD_EUR;
});

test("sans appel mesuré, le budget garde l'estimation", async () => {
  assert.equal(reel(2), 2, "no meter");
  assert.equal(await avecCompteur(async () => reel(0.5)), 0.5, "a meter but no measured call (another provider, no AI)");
});
