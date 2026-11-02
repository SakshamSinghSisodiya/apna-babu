import { handle } from "@/lib/route";
import { chatJSON, translateText, transliterateText } from "@/lib/sarvam";
import { LANG_NAME_EN, LANGUAGES, type LangId } from "@/lib/languages";
import { normalizeByType } from "@/lib/validate";
import type { AnswerResult, Field, FormLang } from "@/lib/types";

export const maxDuration = 60;

const SYSTEM = `You help a person fill an Indian paper form by voice. The user's transcript may be in English, Hindi, Marathi or Hinglish and may contain speech-recognition errors. Output ONLY JSON:
{"intent":"answer|yes|no|skip|unknown|edit|question","value":"","value_latin":"","value_form":"","valid":true,"problem_en":""}
- In either stage, intent="question" if the user is clearly ASKING something about the document, the form or this field instead of answering, e.g. "why do you need my Aadhaar?", "what is the last date?", "ye form kis liye hai?", "IFSC क्या होता है?". A plain value is never a question.
- stage "answer": the user is giving the value for the field. intent="answer" and extract ONLY the value (drop filler like "my name is").
  * value = the value as the user said it, in their own script (Devanagari for Hindi/Marathi speech, Roman for English/Hinglish).
  * value_latin = the value to print on an ENGLISH form in Latin script: transliterate names/places/addresses (e.g. "राहुल पाटील" -> "Rahul Patil"); translate descriptive answers by meaning (e.g. "किसान" -> "Farmer", "मेरी पत्नी" -> "Wife"); for choice fields give the exact matching option in English.
  * value_form = the value exactly as it must be written on the printed form, in form_language and its script, WHATEVER language the user spoke. Transliterate names/places/addresses (form_language Hindi: "Rahul Patil" -> "राहुल पाटील"); translate descriptive answers and choices by meaning (form_language Hindi: "farmer" -> "किसान"; form_language Marathi: "किसान" -> "शेतकरी"). Keep codes like PAN or IFSC as they are. If form_language is English, value_form = value_latin.
  * Convert spoken numbers (incl. Hindi/Marathi number words like "नौ आठ सात", "पंचवीस हजार") to digits. Dates -> DD/MM/YYYY. Phone: 10 digits. PIN code: 6 digits. Email: lowercase, "at the rate"->@, "dot"->".". Amounts: plain digits without commas.
  * If the user wants to skip / does not know: intent="skip". If it is unintelligible or unrelated: intent="unknown".
  * valid=false with a short English problem_en if the value is impossible for the field (e.g. phone not 10 digits, impossible date, option not in the list).
- stage "confirm": the app asked "is <value> correct?". intent="yes" if they agree, "no" if they reject without giving a new value, or intent="answer" with the corrected value/value_latin if they gave a corrected value, "skip" if they want to skip.`;

const OTHER_THAN_LATIN = /(?![\p{Script=Latin}])\p{L}/u;
const FORM_SCRIPTS: Record<FormLang, RegExp> = { en: /\p{Script=Latin}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, bn: /\p{Script=Bengali}/u, gu: /\p{Script=Gujarati}/u, kn: /\p{Script=Kannada}/u, ml: /\p{Script=Malayalam}/u, od: /\p{Script=Oriya}/u, pa: /\p{Script=Gurmukhi}/u, ta: /\p{Script=Tamil}/u, te: /\p{Script=Telugu}/u };
const FORM_NAMES: Record<FormLang, string> = { en: "English", hi: "Hindi", mr: "Marathi", bn: "Bengali", gu: "Gujarati", kn: "Kannada", ml: "Malayalam", od: "Odia", pa: "Punjabi", ta: "Tamil", te: "Telugu" };

// What goes on a non-English form. The model's value_form wins; these are fallbacks for when it answered in the wrong script.
async function inFormLanguage(field: Field, latin: string, spoken: string, spokenLang: LangId, fromModel: unknown, formLang: FormLang): Promise<string | undefined> {
  const code = `${formLang}-IN`;
  const raw = String(fromModel ?? "");
  const model = FORM_SCRIPTS[formLang].test(raw) ? raw : "";
  if (field.type === "yesno") return translateText(latin, code, "formal").catch(() => latin); // the model echoes whole phrases here
  if (field.type === "choice") {
    const printed = field.options_form?.[field.options?.indexOf(latin) ?? -1];
    if (printed) return printed;
    if (OTHER_THAN_LATIN.test(latin)) return latin;
    return model || translateText(latin, code, "formal").catch(() => latin);
  }
  if (!["name", "address", "text"].includes(field.type)) return undefined; // digits, dates and emails read the same everywhere
  // Hindi and Marathi share a script, so only comparing catches the model copying the spoken words across.
  const copied = field.type === "text" && model === spoken && LANGUAGES[spokenLang].code !== code;
  if (model && !copied) return model;
  if (copied) return translateText(latin, code, "formal").catch(() => model);
  if (field.type === "text" && /\d/.test(latin)) return latin; // PAN, IFSC and the like
  return transliterateText(latin, "en-IN", code).catch(() => latin);
}

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
    form_language: FORM_NAMES[form_language ?? "en"],
    field: { label: field.label_en, type: field.type, options: field.options, hint: field.hint_en },
    value_being_confirmed: current,
    transcript: String(transcript).slice(0, 500),
  });
  const r = await chatJSON<AnswerResult>(SYSTEM, user, 900);
  const out: AnswerResult = {
    intent: (["answer", "yes", "no", "skip", "unknown", "edit", "question"].includes(r.intent) ? r.intent : "unknown") as AnswerResult["intent"],
    value: String(r.value ?? ""),
    value_latin: String(r.value_latin ?? r.value ?? ""),
    valid: r.valid !== false && !(r.intent === "unknown" && r.problem_en), // a stated problem is a rejection, whatever the flag says
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
    // Whatever the user spoke, an English form gets Latin script.
    if (["name", "address", "text"].includes(field.type) && OTHER_THAN_LATIN.test(out.value_latin)) {
      out.value_latin = await transliterateText(out.value_latin, LANGUAGES[lang].code, "en-IN").catch(() => out.value_latin);
    }
    if (form_language && form_language !== "en") out.value_form = await inFormLanguage(field, out.value_latin, out.value, lang, r.value_form, form_language);
  }
  return out;
});
