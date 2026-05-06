/**
 * Google Gemini (AI Studio) — free-tier friendly for Chud when no Anthropic/OpenAI key.
 * https://aistudio.google.com/apikey
 */

function geminiKey(): string | undefined {
  const k =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  return k || undefined;
}

export function hasGeminiKey(): boolean {
  return !!geminiKey();
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
}

function extractText(data: {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}): string {
  if (data.error?.message) {
    console.warn("[Chud/LLM] Gemini API error:", data.error.message);
    return "";
  }
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts?.length) return "";
  return parts.map((p) => p.text ?? "").join("");
}

export async function geminiComplete(prompt: string, maxTokens: number, systemInstruction?: string): Promise<string> {
  const key = geminiKey();
  if (!key) return "";
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.8,
    },
  };
  if (systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("[Chud/LLM] Gemini error:", res.status, await res.text().catch(() => ""));
    return "";
  }
  const data = (await res.json()) as Parameters<typeof extractText>[0];
  return extractText(data);
}

export async function geminiChat(
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens: number
): Promise<string> {
  const key = geminiKey();
  if (!key) {
    throw new Error("No GEMINI_API_KEY");
  }
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.85,
    },
  };
  if (system.trim()) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 400)}`);
  }
  const data = (await res.json()) as Parameters<typeof extractText>[0];
  const text = extractText(data);
  if (!text) {
    throw new Error("Gemini returned empty text");
  }
  return text;
}
