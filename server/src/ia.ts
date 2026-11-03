import Anthropic from "@anthropic-ai/sdk";

/**
 * One place for every model call. Two providers (Anthropic, Mistral), two tiers (rapide, precis), and a cost
 * estimate per call so the free-plan cap can be enforced. Model names and prices live in env so they can be
 * updated without a release.
 */

export type Tier = "rapide" | "precis";
export type Provider = "anthropic" | "mistral";

export interface ModelInfo { provider: Provider; model: string; cout_lecture_centimes: number }

export function provider(): Provider | null {
  const p = (process.env.LUCIEN_IA_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.MISTRAL_API_KEY ? "mistral" : "")) as Provider | "";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (p === "mistral" && process.env.MISTRAL_API_KEY) return "mistral";
  return null;
}

export function modelFor(tier: Tier): ModelInfo | null {
  const p = provider();
  if (!p) return null;
  if (p === "anthropic") {
    return tier === "rapide"
      ? { provider: p, model: process.env.LUCIEN_MODEL_RAPIDE ?? "claude-haiku-5-5", cout_lecture_centimes: Number(process.env.LUCIEN_COUT_RAPIDE_CENTIMES ?? 0.5) }
      : { provider: p, model: process.env.LUCIEN_MODEL_PRECIS ?? process.env.LUCIEN_MODEL ?? "claude-sonnet-5-5", cout_lecture_centimes: Number(process.env.LUCIEN_COUT_PRECIS_CENTIMES ?? 2) };
  }
  return tier === "rapide"
    ? { provider: p, model: process.env.LUCIEN_MODEL_RAPIDE ?? "mistral-small-latest", cout_lecture_centimes: Number(process.env.LUCIEN_COUT_RAPIDE_CENTIMES ?? 0.4) }
    : { provider: p, model: process.env.LUCIEN_MODEL_PRECIS ?? "mistral-medium-latest", cout_lecture_centimes: Number(process.env.LUCIEN_COUT_PRECIS_CENTIMES ?? 1.5) };
}

export interface Part { type: "text"; text: string }
export interface ImagePart { type: "image"; mime: string; base64: string }
export interface PdfPart { type: "pdf"; base64: string }
export type Content = (Part | ImagePart | PdfPart)[];

export interface StructuredCall {
  tier: Tier;
  system: string;
  content: Content;
  /** Name + JSON schema of the single structured answer expected. */
  tool: { name: string; description: string; schema: Record<string, unknown> };
  maxTokens?: number;
}

/** Asks the model for one structured JSON answer. Returns the parsed object and the model used. */
export async function structured(call: StructuredCall): Promise<{ data: unknown; model: ModelInfo }> {
  const m = modelFor(call.tier);
  if (!m) throw new Error("Aucun fournisseur d'IA configuré");
  if (m.provider === "anthropic") return { data: await anthropicStructured(m.model, call), model: m };
  return { data: await mistralStructured(m.model, call), model: m };
}

/** Plain text answer (letters). */
export async function text(call: { tier: Tier; system: string; prompt: string; maxTokens?: number }): Promise<string> {
  const m = modelFor(call.tier);
  if (!m) throw new Error("Aucun fournisseur d'IA configuré");
  if (m.provider === "anthropic") {
    const res = await anthropicCreate({ model: m.model, max_tokens: call.maxTokens ?? 1200, system: call.system, messages: [{ role: "user", content: call.prompt }] });
    const t = res.content.find((b) => b.type === "text");
    return t && t.type === "text" ? t.text : "";
  }
  const r = await mistralChat(m.model, [{ role: "system", content: call.system }, { role: "user", content: call.prompt }], undefined, call.maxTokens ?? 1200);
  return r;
}

// ---------- Anthropic ----------

/**
 * Claude 5.5 models (Sonnet 5.5, Haiku 5.5) — documented in their migration guides:
 *  - a forced tool_choice (« tool » / « any ») returns a 400 → tool_choice « auto », the tool asked for in the instructions;
 *  - thinking is on by default and draws on max_tokens → light thinking for extraction (effort « low »;
 *    on Sonnet 5.5 « between_tools » removes the up-front thinking) and room left in max_tokens;
 *  - temperature, top_p, top_k must be left out (Lucien never sends them to Anthropic).
 * A model that still refuses one of these settings is remembered, and the call is made again without it.
 */
const generation55 = (model: string) => /-5-5\b|5\.5/.test(model);
const refus = new Map<string, Set<"choix_force" | "reglages">>();
const refuse = (model: string, quoi: "choix_force" | "reglages") => refus.get(model)?.has(quoi) ?? false;
const noter = (model: string, quoi: "choix_force" | "reglages") => refus.set(model, new Set([...(refus.get(model) ?? []), quoi]));

export function reglagesAnthropic(model: string, usage: "extraction" | "redaction"): Record<string, unknown> {
  if (!generation55(model) || refuse(model, "reglages")) return {};
  return { ...(usage === "extraction" && /sonnet/.test(model) ? { thinking: { type: "between_tools" } } : {}), output_config: { effort: "low" } };
}

/** One call, with the 5.5 settings; a 400 about one of them is remembered and the call retried without it. */
export async function anthropicCreate(params: Record<string, unknown>, usage: "extraction" | "redaction" = "redaction"): Promise<Anthropic.Message> {
  const client = new Anthropic();
  const model = String(params.model);
  const avec = () => ({ ...params, ...reglagesAnthropic(model, usage), max_tokens: Math.max(Number(params.max_tokens ?? 1024), generation55(model) ? 4096 : 0) });
  try { return await client.messages.create(avec() as unknown as Anthropic.MessageCreateParamsNonStreaming); }
  catch (e) {
    const msg = String((e as Error).message);
    if (!/thinking|output_config|effort|between_tools/.test(msg) || refuse(model, "reglages")) throw e;
    noter(model, "reglages");
    return client.messages.create(avec() as unknown as Anthropic.MessageCreateParamsNonStreaming);
  }
}

async function anthropicStructured(model: string, call: StructuredCall): Promise<unknown> {
  const content: Anthropic.ContentBlockParam[] = call.content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text }
      : p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.mime as any, data: p.base64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } }
  );
  const base = {
    model, max_tokens: call.maxTokens ?? 1024, system: call.system,
    tools: [{ name: call.tool.name, description: call.tool.description, input_schema: call.tool.schema as any }],
    messages: [{ role: "user", content }],
  };
  const libre = () => anthropicCreate({ ...base, tool_choice: { type: "auto" }, system: `${call.system}\n\nRéponds uniquement en appelant l'outil « ${call.tool.name} », sans texte autour.` }, "extraction");
  let res: Anthropic.Message;
  if (generation55(model) || refuse(model, "choix_force")) res = await libre();
  else try { res = await anthropicCreate({ ...base, tool_choice: { type: "tool", name: call.tool.name } }, "extraction"); }
  catch (e) {
    if (!/tool_choice/.test(String((e as Error).message))) throw e;
    noter(model, "choix_force");
    res = await libre();
  }
  const tool = res.content.find((b) => b.type === "tool_use");
  if (tool && tool.type === "tool_use") return tool.input;
  // last resort: a JSON object written as text
  const t = res.content.find((b) => b.type === "text");
  const json = t && t.type === "text" ? t.text.match(/\{[\s\S]*\}/)?.[0] : null;
  if (json) { try { return JSON.parse(json); } catch { /* fall through */ } }
  throw new Error(res.stop_reason === "max_tokens" ? "Réponse coupée (max_tokens)" : "Pas de réponse structurée");
}

// ---------- Mistral (OpenAI-compatible chat API, JSON mode, vision through image_url) ----------

async function mistralChat(model: string, messages: unknown[], jsonMode: boolean | undefined, maxTokens: number): Promise<string> {
  const res = await fetch(`${process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai"}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0, ...(jsonMode ? { response_format: { type: "json_object" } } : {}) }),
  });
  if (!res.ok) throw new Error(`Mistral ${res.status} ${await res.text().catch(() => "")}`);
  const j = (await res.json()) as any;
  return j.choices?.[0]?.message?.content ?? "";
}

async function mistralStructured(model: string, call: StructuredCall): Promise<unknown> {
  const parts: any[] = [];
  for (const p of call.content) {
    if (p.type === "text") parts.push({ type: "text", text: p.text });
    else if (p.type === "image") parts.push({ type: "image_url", image_url: `data:${p.mime};base64,${p.base64}` });
    else parts.push({ type: "document_url", document_url: `data:application/pdf;base64,${p.base64}` });
  }
  parts.push({ type: "text", text: `Réponds uniquement avec un objet JSON respectant ce schéma (toutes les clés obligatoires) :\n${JSON.stringify(call.tool.schema)}` });
  const out = await mistralChat(model, [{ role: "system", content: call.system }, { role: "user", content: parts }], true, call.maxTokens ?? 1024);
  const start = out.indexOf("{"), end = out.lastIndexOf("}");
  return JSON.parse(out.slice(start, end + 1));
}
