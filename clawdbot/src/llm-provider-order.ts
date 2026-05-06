import { hasGeminiKey } from "./gemini.js";
import { hasOllama } from "./ollama.js";

export type ChudLlmBackend = "anthropic" | "openai" | "gemini" | "ollama";

/** Prefer Ollama when CHUD_LLM_PROVIDER=ollama|local (e.g. you still have old keys in .env but want local). */
export function chudLlmBackendOrder(): ChudLlmBackend[] {
  const prefer = process.env.CHUD_LLM_PROVIDER?.trim().toLowerCase();
  if ((prefer === "ollama" || prefer === "local") && hasOllama()) {
    return ["ollama", "anthropic", "openai", "gemini"];
  }
  return ["anthropic", "openai", "gemini", "ollama"];
}

export function anyChudLlmConfigured(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    hasGeminiKey() ||
    hasOllama()
  );
}
