import { handle } from "@/lib/route";
import { sarvamJSON, transliterateText } from "@/lib/sarvam";
import { BABU_VOICE, LANGUAGES, type LangId } from "@/lib/languages";

export const maxDuration = 60;

function chunk(text: string, max = 900): string[] {
  const parts = text.match(/[^.?!।]+[.?!।]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export const POST = handle(async (req) => {
  const { text, lang } = (await req.json()) as { text: string; lang: LangId };
  const cfg = LANGUAGES[lang];
  if (!cfg || !String(text).trim()) throw new Error("bad request");
  let spoken = String(text).slice(0, 2400);
  // Bulbul reads Devanagari best: if Hinglish arrives in Roman script, convert it first.
  if (lang === "hinglish" && /[A-Za-z]/.test(spoken) && !/[ऀ-ॿ]/.test(spoken)) {
    spoken = await transliterateText(spoken, "en-IN", "hi-IN").catch(() => spoken);
  }
  const audios: string[] = [];
  for (const c of chunk(spoken)) {
    const d = await sarvamJSON("/text-to-speech", {
      json: { text: c, language_code: cfg.code, model: "bulbul:v4-flash", speaker: BABU_VOICE, pace: 1, speech_sample_rate: 22050, output_audio_codec: "wav" },
      timeoutMs: 30000,
    });
    audios.push(...(d.audios ?? []));
  }
  return { audios };
});
