import { handle } from "@/lib/route";
import { chatJSON } from "@/lib/sarvam";
import type { FormSchema } from "@/lib/types";

export const maxDuration = 60;

const SYSTEM = `You are Apna Babu, an expert at Indian government and bank paperwork. You receive the text (markdown) of a scanned document. Output ONLY a single-line minified JSON object, no prose, no line breaks or indentation. Leave out optional keys that do not apply (options, hint_en, prefilled_value, label_form, title_form):
{
 "doc_type": "short_snake_case",
 "is_form": true|false,
 "title": "title of the document the user must FILL (English)",
 "form_language": "en|hi|mr: main printed language of a FORM; en for anything else or for response documents",
 "title_form": "for hi/mr forms only: the title exactly as printed",
 "summary_en": "1-2 simple English sentences: what this document is / what it is for",
 "required_attachments": ["documents to attach or carry, e.g. 'Aadhaar card copy'"],
 "fields": [{"id":"snake_case_unique","label_en":"short English label","label_form":"for hi/mr forms only: the label exactly as printed","question_en":"a friendly question asking the user for it, e.g. 'What is your date of birth?'","section":"section heading","type":"text|name|date|phone|pincode|email|number|address|choice|yesno","options":["only for choice"],"required":true,"hint_en":"optional short hint","prefilled_value":"only if already printed in the document"}]
}
Rules:
- If the document is a FORM or application: fields = the blanks the user must fill, in order. Skip office-use-only boxes, signature and declaration boxes.
- If it is NOT a form (bill, notice, court summons, bank letter, etc.): set is_form=false, explain it simply in summary_en (what it says, any deadline or amount), choose the right RESPONSE document (complaint, reply letter, RTI application, request letter), set title to that document, and make fields = the details needed to write it (applicant name, address, reference/case/account number from the document as prefilled_value, date, the grievance or request in the user's words, etc.).
- At most 25 fields, at least 3: on a long form keep the 25 that matter most for the applicant. Merge tiny related blanks (e.g. address lines -> one address field; one box per letter or digit -> one field). Keep labels and questions short.
- Use type "name" for person names, "address" for postal addresses, "number" for amounts/IDs/Aadhaar/account numbers.`;

export const POST = handle(async (req) => {
  const { markdown } = await req.json();
  const text = String(markdown ?? "").slice(0, 12000);
  if (text.trim().length < 20) throw new Error("empty document");
  let s = await chatJSON<FormSchema>(SYSTEM, "DOCUMENT:\n" + text, 6000, 28000);
  if (!s.fields?.length) s = await chatJSON<FormSchema>(SYSTEM, "DOCUMENT:\n" + text, 6000, 28000);
  if (!Array.isArray(s.fields) || s.fields.length === 0) throw new Error("no fields");
  const seen = new Set<string>();
  s.fields = s.fields.slice(0, 25).map((f, i) => {
    let id = String(f.id || `f${i}`).replace(/[^\w]/g, "_");
    while (seen.has(id)) id += "_";
    seen.add(id);
    return {
      ...f,
      id,
      section: f.section || "Details",
      required: f.required !== false,
      question_en: f.question_en || `What is your ${f.label_en}?`,
      type: (["text", "name", "date", "phone", "pincode", "email", "number", "address", "choice", "yesno"].includes(f.type) ? f.type : "text") as FormSchema["fields"][number]["type"],
    };
  });
  s.required_attachments = Array.isArray(s.required_attachments) ? s.required_attachments.slice(0, 8) : [];
  s.is_form = s.is_form !== false;
  s.form_language = s.is_form && (s.form_language === "hi" || s.form_language === "mr") ? s.form_language : "en";
  return s;
});
