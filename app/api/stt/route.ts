import { handle } from "@/lib/route";
import { sarvamJSON, transliterateText } from "@/lib/sarvam";
import { LANGUAGES, type LangId } from "@/lib/languages";

export const maxDuration = 30;

export const POST = handle(async (req) => {
  const incoming = await req.formData();
  const audio = incoming.get("audio");
  const lang = incoming.get("lang") as LangId;
  const cfg = LANGUAGES[lang];
  if (!(audio instanceof File) || !cfg) throw new Error("bad request");
  const transcribe = (code: string, mode: string) =>
    sarvamJSON("/speech-to-text", {
      form: () => {
        const f = new FormData();
        f.append("file", audio, audio.name || "speech.wav");
        f.append("model", "saaras:v4");
        f.append("language_code", code);
        f.append("mode", mode);
        return f;
      },
      timeoutMs: 25000,
    });
  // Saaras translates Hindi speech to English when told en-IN, hiding the mismatch from Language
  // Identification. A second auto-detect pass keeps the words in the language actually spoken.
  const [d, auto] = await Promise.all([transcribe(cfg.code, cfg.sttMode ?? "transcribe"), transcribe("unknown", "transcribe").catch(() => null)]);
  const transcript: string = d.transcript ?? "";
  // Hinglish: show Roman script (code-mix output is Devanagari + English words).
  const display = lang === "hinglish" && /[ऀ-ॿ]/.test(transcript) ? await transliterateText(transcript, "hi-IN", "en-IN").catch(() => transcript) : transcript;
  return { transcript, display, native: (auto?.transcript as string) ?? "" };
});
