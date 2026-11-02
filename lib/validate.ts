import type { FieldType } from "./types";

const DEVA_DIGITS = "०१२३४५६७८९";

export function toAsciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d)));
}

// Deterministic normalisation/validation on top of whatever the LLM extracted.
export function normalizeByType(type: FieldType, raw: string, label = ""): { value: string; ok: boolean; problem?: string } {
  const v = toAsciiDigits(raw).trim();
  switch (type) {
    case "phone": {
      let d = v.replace(/\D/g, "");
      if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
      if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
      return d.length === 10 ? { value: d, ok: true } : { value: d, ok: false, problem: "A mobile number must have exactly 10 digits." };
    }
    case "pincode": {
      const d = v.replace(/\D/g, "");
      return d.length === 6 ? { value: d, ok: true } : { value: d, ok: false, problem: "A PIN code must have exactly 6 digits." };
    }
    case "email": {
      const e = v
        .toLowerCase()
        .replace(/\s+at the rate( of)?\s+/g, "@")
        .replace(/\s+at\s+/g, "@")
        .replace(/\s+dot\s+/g, ".")
        .replace(/\s+/g, "");
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? { value: e, ok: true } : { value: e, ok: false, problem: "That does not look like a valid email address." };
    }
    case "date": {
      const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
      if (!m) return { value: v, ok: false, problem: "Please give the date as day, month and year." };
      const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const dt = new Date(y, mo - 1, d);
      const valid = dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y > 1900;
      return valid
        ? { value: `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`, ok: true }
        : { value: v, ok: false, problem: "That date does not exist. Please say it again." };
    }
    case "number": {
      const n = v.replace(/[^\d.]/g, "");
      if (/aadhaar|aadhar/i.test(label) && n.length !== 12) return { value: n, ok: false, problem: "An Aadhaar number must have exactly 12 digits." };
      return n ? { value: n, ok: true } : { value: v, ok: false, problem: "Please give a number." };
    }
    default:
      return v ? { value: v, ok: true } : { value: v, ok: false, problem: "I did not catch that." };
  }
}

// Read digits one by one so TTS does not say "nine billion ...".
export function speakableValue(type: FieldType, value: string): string {
  if (type === "phone" || type === "pincode") return value.split("").join(" ");
  if (type === "email") return value.replace(/@/g, " at ").replace(/\./g, " dot ");
  if (type === "date") return value.replace(/\//g, " ");
  if (type === "number" && /^\d+$/.test(value)) {
    if (value.length > 6) return value.split("").join(" "); // IDs and account numbers
    if (value.length > 4) return value.replace(/\B(?=(\d{3})$)/, ","); // Bulbul reads "25,000" as a whole number
  }
  return value;
}

const YES = ["yes", "yeah", "yep", "yup", "correct", "right", "ok", "okay", "sure", "haan", "han", "haa", "ha", "ji", "bilkul", "sahi", "theek", "thik", "ho", "hoy", "hoye", "barobar", "बरोबर", "हाँ", "हां", "हा", "हो", "होय", "सही", "ठीक", "बिल्कुल", "जी", "जी हाँ", "जी हां"];
const NO = ["no", "nope", "nah", "wrong", "incorrect", "nahi", "nahin", "nai", "na", "galat", "nako", "naahi", "nahi", "नाही", "नहीं", "नही", "ना", "गलत", "चूक", "नको", "नको"];
// Only count when they are the whole answer: "next to the temple" is an address, not a skip.
const SKIP_ALONE = ["pass", "later", "next"];
const SKIP = ["skip", "chhodo", "chodo", "chhod do", "pata nahi", "pata nahin", "maalum nahi", "mahit nahi", "mahit nahin", "i dont know", "i don't know", "dont know", "don't know", "no idea", "पता नहीं", "पता नही", "माहित नाही", "माहीत नाही", "छोड़ो", "छोडो", "स्किप", "नहीं पता"];

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?।'’"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function quickIntent(text: string): "yes" | "no" | "skip" | null {
  const t = clean(text);
  if (!t) return null;
  if (SKIP_ALONE.includes(t)) return "skip";
  const padded = ` ${t} `;
  if (SKIP.some((w) => padded.includes(` ${clean(w)} `))) return "skip";
  const words = t.split(" ");
  if (words.length > 4) return null;
  const hasNo = words.some((w) => NO.includes(w));
  const hasYes = words.some((w) => YES.includes(w));
  if (hasNo && !hasYes && words.length <= 2) return "no";
  if (hasYes && !hasNo) return "yes";
  return null;
}

const START = ["start", "begin", "shuru", "suru", "chalo", "chala", "chaliye", "form", "शुरू", "शुरु", "सुरू", "सुरु", "स्टार्ट", "चलो", "चला", "चलिए", "फॉर्म", "फ़ॉर्म"];

// After the explanation: a short "yes", "no questions" or "start" means begin the form. Anything else is a question.
export function wantsToStart(text: string): boolean {
  if (/[?？]/.test(text)) return false;
  const words = clean(text).split(" ");
  if (words.length > 3) return false;
  return words.some((w) => START.includes(w)) || quickIntent(text) !== null;
}
