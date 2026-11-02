import { transliterateText, translateText } from "./sarvam";
import { LANGUAGES, type LangId } from "./languages";
import type { Localized } from "./types";

export async function localize(text: string, lang: LangId): Promise<Localized> {
  const cfg = LANGUAGES[lang];
  if (lang === "en" || !text.trim()) return { text, speak: text };
  const translated = await translateText(text, cfg.translateTarget, cfg.translateMode);
  if (lang !== "hinglish") return { text: translated, speak: translated };
  // Hinglish: code-mixed Devanagari for the voice, Roman script for display.
  const roman = await transliterateText(translated, "hi-IN", "en-IN").catch(() => translated);
  return { text: roman, speak: translated };
}
