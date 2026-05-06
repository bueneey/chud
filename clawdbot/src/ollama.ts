/**
 * Local Ollama — OpenAI-compatible /v1/chat/completions (no cloud credits).
 * Install: https://ollama.com — then `ollama pull <model>`.
 */

const DEFAULT_BASE = "http://127.0.0.1:11434/v1";

export function hasOllama(): boolean {
  return !!process.env.OLLAMA_MODEL?.trim();
}

export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL!.trim();
}

type ChatMsg = { role: string; content: string };

async function ollamaChatCompletions(body: Record<string, unknown>): Promise<string> {
  const url = `${ollamaBaseUrl()}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.OLLAMA_API_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("[Chud/LLM] Ollama error:", res.status, await res.text().catch(() => ""));
    return "";
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Single user message completion (pick / sell / thought prompts). */
export async function ollamaComplete(prompt: string, maxTokens: number): Promise<string> {
  if (!hasOllama()) return "";
  return ollamaChatCompletions({
    model: ollamaModel(),
    messages: [{ role: "user", content: prompt }],
    stream: false,
    max_tokens: maxTokens,
  });
}

/** Multi-turn chat (site Chud tab). */
export async function ollamaChat(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number
): Promise<string> {
  if (!hasOllama()) throw new Error("No OLLAMA_MODEL");
  const apiMessages: ChatMsg[] = [
    { role: "system", content: system },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const text = await ollamaChatCompletions({
    model: ollamaModel(),
    messages: apiMessages,
    stream: false,
    max_tokens: maxTokens,
  });
  if (!text.trim()) throw new Error("Ollama returned empty text");
  return text;
}
