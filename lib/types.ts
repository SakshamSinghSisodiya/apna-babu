import type { LangId } from "./languages";

export type FormLang = "en" | "hi" | "mr";
export type FieldType = "text" | "name" | "date" | "phone" | "pincode" | "email" | "number" | "address" | "choice" | "yesno";

export interface Field {
  id: string;
  label_en: string;
  label_form?: string; // label as printed, when the form is not in English
  question_en: string;
  section: string;
  type: FieldType;
  options?: string[];
  required: boolean;
  hint_en?: string;
  prefilled_value?: string;
}

export interface FormSchema {
  doc_type: string;
  is_form: boolean;
  title: string;
  title_form?: string; // title as printed, when the form is not in English
  form_language?: FormLang;
  summary_en: string;
  required_attachments: string[];
  fields: Field[];
}

export interface Localized {
  text: string; // display text
  speak: string; // text to send to TTS
}

export interface FieldLoc {
  question: Localized;
  label: string;
}

export interface FieldValue {
  value: string; // as spoken (user's language/script)
  latin: string; // Latin-script value (what goes on an English form)
  form?: string; // value in the form's own script, when the form is not in English
  skipped?: boolean;
}

export interface AnswerResult {
  intent: "answer" | "yes" | "no" | "skip" | "unknown" | "edit";
  value: string;
  value_latin: string;
  value_form?: string;
  valid: boolean;
  problem_en: string;
}

export type { LangId };
