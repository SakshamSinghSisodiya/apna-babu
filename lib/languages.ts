// Single source of truth for supported languages. Add a row to support a new one.
export type LangId = "en" | "hi" | "mr" | "hinglish";

// One warm voice for Apna Babu across every language (Bulbul v4 Flash persona).
export const BABU_VOICE = "shubh_enhi_companion";

export interface LangConfig {
  id: LangId;
  label: string; // button label, in the language itself
  code: string; // BCP-47 code for STT / TTS
  translateTarget: string; // Sarvam Translate target
  translateMode: "formal" | "code-mixed"; // "formal" keeps Hindi/Marathi free of English words
  romanDisplay: boolean; // show text in Roman script
  sttMode?: string; // Saaras mode
  yes: string;
  no: string;
}

export const LANGUAGES: Record<LangId, LangConfig> = {
  en: { id: "en", label: "English", code: "en-IN", translateTarget: "en-IN", translateMode: "formal", romanDisplay: true, yes: "yes", no: "no" },
  hi: { id: "hi", label: "हिंदी", code: "hi-IN", translateTarget: "hi-IN", translateMode: "formal", romanDisplay: false, yes: "हाँ", no: "नहीं" },
  mr: { id: "mr", label: "मराठी", code: "mr-IN", translateTarget: "mr-IN", translateMode: "formal", romanDisplay: false, yes: "हो", no: "नाही" },
  hinglish: { id: "hinglish", label: "Hinglish", code: "hi-IN", translateTarget: "hi-IN", translateMode: "code-mixed", romanDisplay: true, sttMode: "codemix", yes: "haan", no: "nahi" },
};

export const LANG_LIST: LangConfig[] = [LANGUAGES.en, LANGUAGES.hi, LANGUAGES.mr, LANGUAGES.hinglish];

export const LANG_NAME_EN: Record<LangId, string> = {
  en: "English",
  hi: "Hindi (Devanagari)",
  mr: "Marathi (Devanagari)",
  hinglish: "Hinglish (Hindi-English mix in Roman script)",
};

// Map a Sarvam LID result to one of our languages.
export function langFromLid(code?: string | null, script?: string | null): LangId | null {
  if (code === "en-IN") return "en";
  if (code === "mr-IN") return "mr";
  if (code === "hi-IN") return script === "Latn" ? "hinglish" : "hi";
  return null;
}
