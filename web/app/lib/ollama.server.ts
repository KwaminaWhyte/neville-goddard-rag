// Ollama client for generation (gemma4). Embeddings/retrieval are handled by LightRAG.
import "dotenv/config";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
export const GEN_MODEL = process.env.GEN_MODEL || "gemma4:26b-mlx";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export async function chat(messages: ChatMsg[], opts?: { temperature?: number }): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEN_MODEL,
      messages,
      stream: false,
      options: { temperature: opts?.temperature ?? 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`ollama chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

// Health probe: reachable + GEN_MODEL pulled. Never throws.
export async function ollamaHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, detail: `unreachable: ${res.status}` };
    const data = await res.json();
    const models: string[] = Array.isArray(data.models)
      ? data.models.map((m: { name?: string }) => m.name ?? "")
      : [];
    if (!models.includes(GEN_MODEL)) {
      return { ok: false, detail: `model ${GEN_MODEL} not pulled` };
    }
    return { ok: true, detail: "connected" };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${(e as Error).message}` };
  }
}

// Streamed chat — yields content tokens as they arrive.
export async function* chatStream(
  messages: ChatMsg[],
  opts?: { temperature?: number }
): AsyncGenerator<string> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEN_MODEL,
      messages,
      stream: true,
      options: { temperature: opts?.temperature ?? 0.8 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama stream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) yield json.message.content;
      } catch {
        /* partial */
      }
    }
  }
}
