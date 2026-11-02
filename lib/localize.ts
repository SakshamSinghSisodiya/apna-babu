import { transliterateText, translateText } from "./sarvam";
import { LANGUAGES, type LangId } from "./languages";
import type { Localized } from "./types";

const NUMBER = /[\d०-९][\d०-९,./-]*[\d०-९]|[\d०-९]/g;
const plain = (n: string) => n.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))).replace(/,/g, "");

// Translation can quietly change a figure (it has turned 15/11/2026 into 15/11/2027), and on a notice that is the
// part that matters most. Any number that did not survive is put back from the English.
export function keepNumbers(source: string, translated: string): string {
  const wanted = source.match(NUMBER) ?? [];
  const got = translated.match(NUMBER) ?? [];
  const missing = wanted.filter((n) => !got.some((g) => plain(g) === plain(n)));
  if (!missing.length) return translated;
  const wrong = got.filter((g) => !wanted.some((n) => plain(n) === plain(g)));
  let out = translated;
  missing.forEach((n, i) => {
    if (wrong[i]) out = out.replace(wrong[i], n);
  });
  return missing.length > wrong.length ? `${out} (${missing.slice(wrong.length).join(", ")})` : out;
}

// Mayura occasionally drops letters from another Indian script into a word.
const STRAY_SCRIPT = /(?![\p{Script=Devanagari}\p{Script=Latin}])\p{L}/u;

async function translateClean(text: string, target: string, mode: string, model?: string): Promise<string> {
  const first = await translateText(text, target, mode, "en-IN", undefined, model);
  return STRAY_SCRIPT.test(first) && !model ? translateText(text, target, "formal", "en-IN", undefined, "sarvam-translate:v1").catch(() => first) : first;
}

// Drops any sentence quoting an amount, date or ID that is nowhere in the source. Short numbers are left alone:
// "two photos" often comes back as "2".
export function onlySupported(sentences: string[], source: string): string[] {
  const known = new Set((source.match(NUMBER) ?? []).map(plain));
  return sentences.filter((s) => (s.match(NUMBER) ?? []).every((n) => plain(n).length < 3 || known.has(plain(n))));
}

export async function localize(text: string, lang: LangId): Promise<Localized> {
  const cfg = LANGUAGES[lang];
  if (lang === "en" || !text.trim()) return { text, speak: text };
  const translated = keepNumbers(text, await translateClean(text, cfg.translateTarget, cfg.translateMode, cfg.translateModel));
  if (lang !== "hinglish") return { text: translated, speak: translated };
  // Hinglish: code-mixed Devanagari for the voice, Roman script for display.
  const roman = await translateText(text, cfg.translateTarget, cfg.translateMode, "en-IN", "roman").catch(() => transliterateText(translated, "hi-IN", "en-IN"));
  return { text: keepNumbers(text, roman), speak: translated };
}
