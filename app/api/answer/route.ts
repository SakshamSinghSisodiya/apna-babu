import { handle } from "@/lib/route";
import { chatJSON, transliterateText } from "@/lib/sarvam";
import { LANG_NAME_EN, type LangId } from "@/lib/languages";
import { normalizeByType } from "@/lib/validate";
import type { AnswerResult, Field, FormLang } from "@/lib/types";

export const maxDuration = 60;

const SYSTEM = `You help a person fill an Indian paper form by voice. The user's transcript may be in English, Hindi, Marathi or Hinglish and may contain speech-recognition errors. Output ONLY JSON:
{"intent":"answer|yes|no|skip|unknown|edit","value":"","value_latin":"","valid":true,"problem_en":""}
- stage "answer": the user is giving the value for the field. intent="answer" and extract ONLY the value (drop filler like "my name is").
  * value = the value as the user said it, in their own script (Devanagari for Hindi/Marathi speech, Roman for English/Hinglish).
  * value_latin = the value to print on an ENGLISH form in Latin script: transliterate names/places/addresses (e.g. "राहुल पाटील" -> "Rahul Patil"); for choice fields give the exact matching option in English.
  * Convert spoken numbers (incl. Hindi/Marathi number words like "नौ आठ सात", "पंचवीस हजार") to digits. Dates -> DD/MM/YYYY. Phone: 10 digits. PIN code: 6 digits. Email: lowercase, "at the rate"->@, "dot"->".". Amounts: plain digits without commas.
  * If the user wants to skip / does not know: intent="skip". If it is unintelligible or unrelated: intent="unknown".
  * valid=false with a short English problem_en if the value is impossible for the field (e.g. phone not 10 digits, impossible date, option not in the list).
- stage "confirm": the app asked "is <value> correct?". intent="yes" if they agree, "no" if they reject without giving a new value, or intent="answer" with the corrected value/value_latin if they gave a corrected value, "skip" if they want to skip.`;

export const POST = handle(async (req) => {
  const { field, transcript, lang, stage, current, form_language } = (await req.json()) as {
    field: Field;
    transcript: string;
    lang: LangId;
    stage: "answer" | "confirm";
    current?: string;
    form_language?: FormLang;
  };
  const user = JSON.stringify({
    stage,
    language: LANG_NAME_EN[lang],
    field: { label: field.label_en, type: field.type, options: field.options, hint: field.hint_en },
    value_being_confirmed: current,
    transcript: String(transcript).slice(0, 500),
  });
  const r = await chatJSON<AnswerResult>(SYSTEM, user, 600);
  const out: AnswerResult = {
    intent: (["answer", "yes", "no", "skip", "unknown", "edit"].includes(r.intent) ? r.intent : "unknown") as AnswerResult["intent"],
    value: String(r.value ?? ""),
    value_latin: String(r.value_latin ?? r.value ?? ""),
    valid: r.valid !== false,
    problem_en: String(r.problem_en ?? ""),
  };
  if (out.intent === "answer") {
    if (field.type === "choice" && field.options?.length) {
      const hit = field.options.find((o) => o.toLowerCase() === out.value_latin.trim().toLowerCase());
      if (!hit) return { ...out, valid: false, problem_en: `Please choose one of: ${field.options.join(", ")}.` };
      out.value_latin = hit;
    } else {
      const n = normalizeByType(field.type, out.value_latin || out.value, field.label_en);
      if (!n.ok) return { ...out, valid: false, problem_en: out.problem_en || n.problem || "" };
      out.value_latin = n.value;
      if (["phone", "pincode", "date", "number", "email"].includes(field.type)) out.value = n.value;
    }
    if (field.type === "yesno") out.value_latin = /^(y|ha|ho)/i.test(out.value_latin) ? "Yes" : out.value_latin;
    // A Hindi or Marathi form gets names and addresses in its own script, even if the user typed Roman.
    if (form_language && form_language !== "en" && ["name", "address", "text"].includes(field.type)) {
      out.value_form = /[ऀ-ॿ]/.test(out.value) ? out.value : await transliterateText(out.value_latin, "en-IN", `${form_language}-IN`).catch(() => out.value_latin);
    }
  }
  return out;
});
