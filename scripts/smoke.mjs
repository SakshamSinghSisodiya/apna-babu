// Hits every API route on a running server: BASE=http://localhost:3000 npm run smoke
const BASE = process.env.BASE || "http://localhost:3000";
let failed = 0;

async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    console.log(`PASS ${name} (${Date.now() - t}ms) ${note ?? ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name} (${Date.now() - t}ms) ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert(r.ok, `HTTP ${r.status}`);
  return r.json();
}

// A one-page English form as a PDF, built by hand so the test needs no fixture or library.
function samplePdf() {
  const lines = ["GRAM PANCHAYAT BIRTH CERTIFICATE APPLICATION", "1. Name of child: ____________", "2. Date of birth: ____________", "3. Mother name: ____________", "4. Father name: ____________", "5. Mobile number: ____________", "6. PIN code: ______", "Attach: hospital discharge slip, Aadhaar copy of parents."];
  const stream = "BT /F1 14 Tf 60 760 Td 22 TL " + lines.map((l) => `(${l}) Tj T*`).join(" ") + " ET";
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>", `<</Length ${stream.length}>>stream\n${stream}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let pdf = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xr = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xr}\n%%EOF`;
  return pdf;
}

const QUESTIONS = ["What is your full name?", "What is your mobile number?"];
for (const lang of ["hi", "mr", "hinglish"]) {
  await step(`translate ${lang}`, async () => {
    const { items } = await post("/api/translate", { texts: QUESTIONS, lang });
    assert(items.length === 2 && items[0].text && items[0].speak, "missing items");
    if (lang === "hinglish") assert(!/[ऀ-ॿ]/.test(items[0].text), "Hinglish display must be Roman: " + items[0].text);
    else assert(/[ऀ-ॿ]/.test(items[0].text) && !/[A-Za-z]/.test(items[0].text), "must be pure Devanagari: " + items[0].text);
    return items.map((i) => i.text).join(" | ");
  });
}

const clips = {};
const SPOKEN = { en: "My name is Rahul Patil", hi: "मेरा नाम राहुल पाटील है", mr: "माझं नाव राहुल पाटील आहे", hinglish: "Mera naam Rahul Patil hai" };
for (const [lang, text] of Object.entries(SPOKEN)) {
  await step(`tts ${lang}`, async () => {
    const { audios } = await post("/api/tts", { text, lang });
    assert(audios?.[0]?.length > 1000, "no audio");
    clips[lang] = audios[0];
    return `${audios[0].length} b64 chars`;
  });
}
for (const lang of Object.keys(SPOKEN)) {
  await step(`stt ${lang} (TTS clip fed back)`, async () => {
    const f = new FormData();
    f.append("audio", new Blob([Buffer.from(clips[lang], "base64")], { type: "audio/wav" }), "speech.wav");
    f.append("lang", lang);
    const r = await fetch(BASE + "/api/stt", { method: "POST", body: f });
    assert(r.ok, `HTTP ${r.status}`);
    const d = await r.json();
    assert(d.transcript.trim(), "empty transcript");
    if (lang === "hinglish") assert(!/[ऀ-ॿ]/.test(d.display), "Hinglish display must be Roman: " + d.display);
    return `${d.display} [native: ${d.native}]`;
  });
}

for (const [text, want] of [["मेरा नाम राहुल है और मैं पुणे में रहता हूँ", "hi"], ["माझं नाव राहुल आहे आणि मी पुण्यात राहतो", "mr"], ["My name is Rahul and I live in Pune", "en"], ["Mera naam Rahul hai aur main Pune mein rehta hoon", "hinglish"]]) {
  await step(`lid ${want}`, async () => {
    const d = await post("/api/lid", { text });
    assert(d.lang === want, `got ${d.lang} (${d.language_code}/${d.script_code})`);
  });
}

await step("transliterate deva->latin", async () => {
  const { text } = await post("/api/transliterate", { text: "राहुल पाटील", from: "hi-IN", to: "en-IN" });
  assert(/^[A-Za-z ]+$/.test(text), text);
  return text;
});

const FIELD = (type, label, extra = {}) => ({ id: "x", label_en: label, question_en: "", section: "", type, required: true, ...extra });
const ANSWERS = [
  ["phone in Hindi words", FIELD("phone", "Mobile number"), "मेरा नंबर नौ आठ सात छह पाँच चार तीन दो एक शून्य है", "hi", (r) => r.valid && r.value_latin === "9876543210"],
  ["short phone is invalid", FIELD("phone", "Mobile number"), "98765", "en", (r) => !r.valid],
  ["Marathi name to Latin", FIELD("name", "Full name"), "माझं नाव राहुल पाटील आहे", "mr", (r) => r.valid && /rahul/i.test(r.value_latin)],
  ["spoken date", FIELD("date", "Date of birth"), "paanch march unnees sau ninyanve", "hinglish", (r) => r.valid && r.value_latin === "05/03/1999"],
  ["choice maps to option", FIELD("choice", "Gender", { options: ["Male", "Female", "Other"] }), "महिला", "hi", (r) => r.valid && r.value_latin === "Female"],
  ["pincode", FIELD("pincode", "PIN code"), "4 1 1 0 3 8", "en", (r) => r.valid && r.value_latin === "411038"],
];
for (const [name, field, transcript, lang, check] of ANSWERS) {
  await step(`answer: ${name}`, async () => {
    const r = await post("/api/answer", { field, transcript, lang, stage: "answer" });
    assert(check(r), JSON.stringify(r));
    return r.value_latin;
  });
}

const DEVA = /[ऀ-ॿ]/;
const FORM_VALUES = [
  ["Hindi speech on an English form is translated", FIELD("text", "Occupation"), "मैं किसान हूँ", "hi", "en", (r) => /farmer/i.test(r.value_latin)],
  ["Hindi name on an English form is transliterated", FIELD("name", "Full name"), "राहुल पाटील", "hi", "en", (r) => /rahul/i.test(r.value_latin) && !DEVA.test(r.value_latin)],
  ["English speech on a Hindi form", FIELD("text", "Occupation"), "I am a farmer", "en", "hi", (r) => /किसान|कृषक/.test(r.value_form)],
  ["English name on a Marathi form", FIELD("name", "Full name"), "Rahul Patil", "en", "mr", (r) => DEVA.test(r.value_form)],
  ["Hindi speech on a Marathi form", FIELD("text", "Occupation"), "मैं किसान हूँ", "hi", "mr", (r) => /शेतकरी/.test(r.value_form)],
  ["English name on a Tamil form", FIELD("name", "Full name"), "Rahul Patil", "en", "ta", (r) => /[஀-௿]/.test(r.value_form)],
  ["choice prints the form's own option", FIELD("choice", "Gender", { options: ["Male", "Female"], options_form: ["पुरुष", "महिला"] }), "female", "en", "hi", (r) => r.value_latin === "Female" && r.value_form === "महिला"],
  ["yes/no is one word on a Marathi form", FIELD("yesno", "Married"), "yes I am", "en", "mr", (r) => /^(होय|हो)\.?$/.test(r.value_form.trim())],
  ["PAN stays as is on a Hindi form", FIELD("text", "PAN number"), "ABCDE1234F", "en", "hi", (r) => /^ABCDE1234F$/i.test(r.value_form)],
];
for (const [name, field, transcript, lang, form_language, check] of FORM_VALUES) {
  await step(`form language: ${name}`, async () => {
    const r = await post("/api/answer", { field, transcript, lang, stage: "answer", form_language });
    assert(check(r), JSON.stringify(r));
    return r.value_form || r.value_latin;
  });
}

await step("schema: Hindi form stays Hindi", async () => {
  const s = await post("/api/schema", { markdown: "ग्राम पंचायत कार्यालय\nजन्म प्रमाण पत्र आवेदन\nआवेदक का नाम: ____\nपिता का नाम: ____\nमोबाइल नंबर: ____\nलिंग: पुरुष / महिला" });
  assert(s.form_language === "hi" && s.fields.some((f) => DEVA.test(f.label_form ?? "")), JSON.stringify(s).slice(0, 300));
  return `${s.title_form}: ${s.fields.length} fields`;
});
await step("schema: English form", async () => {
  const s = await post("/api/schema", { markdown: "BANK OF BHARAT\nFIXED DEPOSIT FORM\nName: ____\nDate of birth: ____\nMobile: ____\nPIN: ____\nAmount: ____\nAttach PAN copy" });
  assert(s.is_form && s.fields.length >= 3, JSON.stringify(s).slice(0, 300));
  return `${s.title}: ${s.fields.length} fields`;
});
await step("schema: notice proposes a response document", async () => {
  const s = await post("/api/schema", { markdown: "MAHARASHTRA STATE ELECTRICITY BOARD\nDISCONNECTION NOTICE\nConsumer No. 170012345678\nYour bill of Rs 48,230 for September is unpaid. Supply will be cut within 15 days. The reading seems higher than normal usage." });
  assert(!s.is_form && s.fields.length >= 3, JSON.stringify(s).slice(0, 300));
  return `${s.title}: ${s.fields.length} fields`;
});
await step("schema: very long form is not cut off", async () => {
  const blanks = ["Applicant name", "Father name", "Mother name", "Spouse name", "Date of birth", "Place of birth", "Gender", "Marital status", "Religion", "Caste", "Nationality", "Occupation", "Annual income", "Education", "Permanent address", "Permanent district", "Permanent state", "Permanent PIN", "Present address", "Present district", "Present state", "Present PIN", "Mobile", "Alternate mobile", "Email", "Aadhaar", "PAN", "Voter ID", "Ration card", "Driving licence", "Bank name", "Branch", "Account number", "IFSC", "Nominee name", "Nominee relation", "Nominee age", "Guardian name", "Guardian address", "Land survey number", "Land area", "Village", "Taluka", "Previous application number", "Previous application date", "Reference 1 name", "Reference 1 mobile", "Reference 2 name", "Reference 2 mobile", "Declaration place"];
  const markdown = "GOVERNMENT OF MAHARASHTRA\nCOMPOSITE WELFARE SCHEME APPLICATION\n" + blanks.map((b, i) => `${i + 1}. ${b}: ____________`).join("\n");
  const s = await post("/api/schema", { markdown });
  assert(s.is_form && s.title && s.fields.length >= 15 && s.fields.length <= 25, `${s.fields?.length} fields`);
  return `${s.title}: ${s.fields.length} fields`;
});
await step("letter", async () => {
  const { letter_en } = await post("/api/letter", { title: "Complaint about high electricity bill", summary: "A disconnection notice for Rs 48,230.", details: [{ label: "Name", value: "Rahul Patil" }, { label: "Consumer number", value: "170012345678" }] });
  assert(letter_en.includes("Rahul Patil"), letter_en);
});
await step("summary", async () => {
  const { summary_en } = await post("/api/summary", { title: "Bank form", filled: 12, missing: ["Email address"], attachments: ["Aadhaar card copy"] });
  assert(summary_en.length > 20, summary_en);
  return summary_en;
});

await step("document intelligence: submit, poll, result", async () => {
  const f = new FormData();
  f.append("file", new Blob([samplePdf()], { type: "application/pdf" }), "form.pdf");
  const r = await fetch(BASE + "/api/doc/submit", { method: "POST", body: f });
  assert(r.ok, `submit HTTP ${r.status}`);
  const { job_id } = await r.json();
  let status = "";
  for (let i = 0; i < 40 && !["completed", "partially_completed", "failed", "rejected"].includes(status); i++) {
    await new Promise((x) => setTimeout(x, 2000));
    status = (await (await fetch(`${BASE}/api/doc/status?job_id=${job_id}`)).json()).status;
  }
  assert(status === "completed", status);
  const res = await fetch(`${BASE}/api/doc/result?job_id=${job_id}`);
  assert(res.ok, `result HTTP ${res.status}`);
  const { markdown } = await res.json();
  assert(/birth/i.test(markdown), markdown.slice(0, 200));
  const s = await post("/api/schema", { markdown });
  assert(s.fields.length >= 3, "no fields");
  return `${s.title}: ${s.fields.map((x) => x.id).join(",")}`;
});

await step("errors stay friendly", async () => {
  const r = await fetch(BASE + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const d = await r.json();
  assert(!r.ok && d.error && !JSON.stringify(d).includes("at "), JSON.stringify(d));
});

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
