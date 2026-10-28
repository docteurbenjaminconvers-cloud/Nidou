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
  const p = (process.env.NIDOU_IA_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.MISTRAL_API_KEY ? "mistral" : "")) as Provider | "";
  if (p === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (p === "mistral" && process.env.MISTRAL_API_KEY) return "mistral";
  return null;
}

export function modelFor(tier: Tier): ModelInfo | null {
  const p = provider();
  if (!p) return null;
  if (p === "anthropic") {
    return tier === "rapide"
      ? { provider: p, model: process.env.NIDOU_MODEL_RAPIDE ?? "claude-haiku-5-5", cout_lecture_centimes: Number(process.env.NIDOU_COUT_RAPIDE_CENTIMES ?? 0.5) }
      : { provider: p, model: process.env.NIDOU_MODEL_PRECIS ?? process.env.NIDOU_MODEL ?? "claude-sonnet-5-5", cout_lecture_centimes: Number(process.env.NIDOU_COUT_PRECIS_CENTIMES ?? 2) };
  }
  return tier === "rapide"
    ? { provider: p, model: process.env.NIDOU_MODEL_RAPIDE ?? "mistral-small-latest", cout_lecture_centimes: Number(process.env.NIDOU_COUT_RAPIDE_CENTIMES ?? 0.4) }
    : { provider: p, model: process.env.NIDOU_MODEL_PRECIS ?? "mistral-medium-latest", cout_lecture_centimes: Number(process.env.NIDOU_COUT_PRECIS_CENTIMES ?? 1.5) };
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
    const client = new Anthropic();
    const res = await client.messages.create({ model: m.model, max_tokens: call.maxTokens ?? 1200, system: call.system, messages: [{ role: "user", content: call.prompt }] });
    const t = res.content.find((b) => b.type === "text");
    return t && t.type === "text" ? t.text : "";
  }
  const r = await mistralChat(m.model, [{ role: "system", content: call.system }, { role: "user", content: call.prompt }], undefined, call.maxTokens ?? 1200);
  return r;
}

// ---------- Anthropic ----------

async function anthropicStructured(model: string, call: StructuredCall): Promise<unknown> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = call.content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text }
      : p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.mime as any, data: p.base64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } }
  );
  const res = await client.messages.create({
    model, max_tokens: call.maxTokens ?? 1024, system: call.system,
    tools: [{ name: call.tool.name, description: call.tool.description, input_schema: call.tool.schema as any }],
    tool_choice: { type: "tool", name: call.tool.name },
    messages: [{ role: "user", content }],
  });
  const tool = res.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("Pas de réponse structurée");
  return tool.input;
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
