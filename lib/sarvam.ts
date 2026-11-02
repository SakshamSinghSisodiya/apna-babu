// Server-only Sarvam helper. Keys come from env; on auth/quota errors we retry once with the fallback key.
const BASE = "https://api.sarvam.ai";
const RETRY_STATUS = new Set([401, 402, 403, 429]);

function keys(): string[] {
  return [process.env.SARVAM_API_KEY, process.env.SARVAM_API_KEY_FALLBACK].filter((k): k is string => !!k);
}

export class SarvamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface CallOpts {
  method?: string;
  json?: unknown;
  form?: () => FormData; // built fresh per attempt (bodies can't be reused)
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function sarvamFetch(path: string, opts: CallOpts = {}): Promise<Response> {
  const list = keys();
  if (list.length === 0) throw new SarvamError(500, "Server is not configured");
  let last: Response | null = null;
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    const headers: Record<string, string> = { "api-subscription-key": key, ...opts.headers };
    if (path.startsWith("/v2/chat")) headers.Authorization = "Bearer " + key;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form();
    else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(BASE + path, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
    });
    if (res.ok) return res;
    last = res;
    const quotaText = res.status === 400 ? (await res.clone().text()).toLowerCase() : "";
    const retry = RETRY_STATUS.has(res.status) || /credit|quota|insufficient/.test(quotaText);
    if (!retry || i === list.length - 1) break;
  }
  const text = last ? await last.text().catch(() => "") : "";
  throw new SarvamError(last?.status ?? 502, text.slice(0, 300));
}

export async function sarvamJSON<T = any>(path: string, opts: CallOpts = {}): Promise<T> {
  const res = await sarvamFetch(path, opts);
  return (await res.json()) as T;
}

// ---- Chat -----------------------------------------------------------------
const CHAT_MODELS = ["sarvam-105b-conversations", "gemma4"];
// Gemma writes the plainest Hindi and Marathi; the other model mixes English words into them.
export const WRITING_MODELS = ["gemma4", "sarvam-105b-conversations"];

// A reply cut off by max_tokens: keep everything up to the last complete object and close what's still open.
function repairTruncated(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let best: { end: number; open: string[] } | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (c === "}" && stack.length) best = { end: i + 1, open: [...stack] };
    }
  }
  return best ? text.slice(0, best.end) + best.open.reverse().join("") : null;
}

export function extractJSON(text: string): any {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
    const repaired = repairTruncated(cleaned.slice(start));
    if (repaired) return JSON.parse(repaired);
  }
  throw new Error("no json");
}

export async function chat(messages: { role: string; content: string }[], maxTokens = 1500, timeoutMs = 20000, models = CHAT_MODELS): Promise<string> {
  let lastErr: unknown;
  for (const model of models) {
    try {
      const data = await sarvamJSON("/v2/chat/completions", {
        json: { model, messages, temperature: 0.2, max_tokens: maxTokens, response_format: { type: "json_object" } },
        timeoutMs,
      });
      const msg = data?.choices?.[0]?.message;
      const content: string = msg?.content ?? "";
      if (content) return content;
      lastErr = new Error("empty");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function chatJSON<T = any>(system: string, user: string, maxTokens = 1500, timeoutMs?: number, models?: string[]): Promise<T> {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastErr: unknown;
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      text = await chat(messages, maxTokens, timeoutMs, models);
    } catch (e) {
      throw e; // chat() already tried every model; retrying would outlast the route's time limit
    }
    try {
      return extractJSON(text) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---- Translate / Transliterate -------------------------------------------
export async function translateText(input: string, target: string, mode: string, source = "en-IN", outputScript?: "roman", model = "mayura:v1"): Promise<string> {
  if (!input.trim() || target === source) return input;
  const data = await sarvamJSON("/translate", {
    json: { input: input.slice(0, 990), source_language_code: source, target_language_code: target, model, mode, speaker_gender: "Male", ...(outputScript ? { output_script: outputScript } : {}) },
  });
  return data.translated_text ?? input;
}

export async function transliterateText(input: string, from: string, to: string): Promise<string> {
  if (!input.trim()) return input;
  const data = await sarvamJSON("/transliterate", {
    json: { input: input.slice(0, 990), source_language_code: from, target_language_code: to },
  });
  return data.transliterated_text ?? input;
}

export function errorStatus(e: unknown): number {
  return e instanceof SarvamError && e.status >= 400 && e.status < 600 ? e.status : 502;
}
