import type { Field, FieldType, FormSchema } from "./types";

type Row = [id: string, label: string, type: FieldType, section: string, question: string, opts?: string[]];

const build = (rows: Row[]): Field[] =>
  rows.map(([id, label_en, type, section, question_en, options]) => ({ id, label_en, type, section, question_en, options, required: true }));

export const SAMPLES: { id: string; emoji: string; name: string; blurb: string; schema: FormSchema }[] = [
  {
    id: "bank",
    emoji: "🏦",
    name: "Bank savings account opening",
    blurb: "Open a basic savings account",
    schema: {
      doc_type: "bank_account_opening",
      is_form: true,
      title: "Savings Bank Account Opening Form",
      summary_en: "This form is used to open a new savings account in a bank.",
      required_attachments: ["2 passport size photographs", "Aadhaar card copy", "PAN card copy"],
      fields: build([
        ["name", "Full name", "name", "Personal details", "What is your full name?"],
        ["father", "Father's / Husband's name", "name", "Personal details", "What is your father's or husband's name?"],
        ["dob", "Date of birth", "date", "Personal details", "What is your date of birth?"],
        ["gender", "Gender", "choice", "Personal details", "What is your gender: male, female or other?", ["Male", "Female", "Other"]],
        ["address", "Residential address", "address", "Contact details", "What is your full residential address?"],
        ["pin", "PIN code", "pincode", "Contact details", "What is your area PIN code?"],
        ["mobile", "Mobile number", "phone", "Contact details", "What is your mobile number?"],
        ["email", "Email address", "email", "Contact details", "What is your email address?"],
        ["aadhaar", "Aadhaar number", "number", "Identity", "What is your 12 digit Aadhaar number?"],
        ["pan", "PAN number", "text", "Identity", "What is your PAN number?"],
        ["occupation", "Occupation", "text", "Financial details", "What work do you do? What is your occupation?"],
        ["income", "Annual income (in rupees)", "number", "Financial details", "What is your approximate yearly income in rupees?"],
        ["nominee", "Nominee name", "name", "Nominee", "Who do you want as the nominee for this account?"],
        ["nominee_rel", "Nominee's relationship", "text", "Nominee", "How is the nominee related to you?"],
      ]),
    },
  },
  {
    id: "scholarship",
    emoji: "🎓",
    name: "Scholarship application",
    blurb: "Apply for a student scholarship",
    schema: {
      doc_type: "scholarship_application",
      is_form: true,
      title: "Scholarship Application Form",
      summary_en: "This form is used to apply for a government scholarship for studies.",
      required_attachments: ["Previous year marksheet", "Income certificate", "Caste certificate (if applicable)", "Bank passbook copy", "Aadhaar card copy"],
      fields: build([
        ["name", "Student's full name", "name", "Student details", "What is the student's full name?"],
        ["dob", "Date of birth", "date", "Student details", "What is the student's date of birth?"],
        ["gender", "Gender", "choice", "Student details", "What is the student's gender: male, female or other?", ["Male", "Female", "Other"]],
        ["category", "Category", "choice", "Student details", "Which category do you belong to: General, OBC, SC, ST or other?", ["General", "OBC", "SC", "ST", "Other"]],
        ["mobile", "Mobile number", "phone", "Contact details", "What is your mobile number?"],
        ["email", "Email address", "email", "Contact details", "What is your email address?"],
        ["address", "Home address", "address", "Contact details", "What is your home address?"],
        ["pin", "PIN code", "pincode", "Contact details", "What is your PIN code?"],
        ["college", "College / school name", "text", "Education", "What is the name of your college or school?"],
        ["course", "Course and year", "text", "Education", "Which course and which year are you studying?"],
        ["percentage", "Last exam percentage", "number", "Education", "What percentage did you get in your last exam?"],
        ["income", "Family annual income (in rupees)", "number", "Family details", "What is your family's total yearly income in rupees?"],
        ["parent", "Parent / guardian name", "name", "Family details", "What is your parent's or guardian's name?"],
        ["account", "Bank account number", "number", "Bank details", "What is your bank account number for the scholarship money?"],
        ["ifsc", "Bank IFSC code", "text", "Bank details", "What is your bank's IFSC code?"],
      ]),
    },
  },
  {
    id: "electricity",
    emoji: "💡",
    name: "New electricity connection",
    blurb: "Apply for a new meter at home",
    schema: {
      doc_type: "electricity_connection",
      is_form: true,
      title: "Application for New Electricity Connection",
      summary_en: "This form is used to request a new electricity meter and connection at your premises.",
      required_attachments: ["Aadhaar card copy", "Property ownership or rent agreement proof", "Latest property tax receipt", "2 passport size photographs"],
      fields: build([
        ["name", "Applicant's full name", "name", "Applicant details", "What is your full name?"],
        ["father", "Father's / Husband's name", "name", "Applicant details", "What is your father's or husband's name?"],
        ["mobile", "Mobile number", "phone", "Applicant details", "What is your mobile number?"],
        ["email", "Email address", "email", "Applicant details", "What is your email address?"],
        ["address", "Premises address", "address", "Premises details", "What is the full address where you need the connection?"],
        ["pin", "PIN code", "pincode", "Premises details", "What is the PIN code of that area?"],
        ["ownership", "Ownership", "choice", "Premises details", "Do you own the premises or is it rented?", ["Owner", "Tenant"]],
        ["category", "Connection category", "choice", "Connection details", "Is this for home, shop, or farm use?", ["Residential", "Commercial", "Agricultural"]],
        ["load", "Required load (in kW)", "number", "Connection details", "How many kilowatts of load do you need?"],
        ["phase", "Phase", "choice", "Connection details", "Do you need a single phase or three phase connection?", ["Single phase", "Three phase"]],
        ["aadhaar", "Aadhaar number", "number", "Identity", "What is your 12 digit Aadhaar number?"],
        ["date", "Connection needed from", "date", "Connection details", "From which date do you need the connection?"],
      ]),
    },
  },
];

// Samples have no scanned text, so explaining them and answering questions works from their schema.
export function schemaAsText(s: FormSchema): string {
  const sections = [...new Set(s.fields.map((f) => f.section))];
  const blanks = sections.map((name) => `${name}:\n` + s.fields.filter((f) => f.section === name).map((f) => `${f.label_en}${f.options ? ` (${f.options.join(" / ")})` : ""}: ______`).join("\n"));
  return [s.title, s.summary_en, ...blanks, s.required_attachments.length ? `Attach: ${s.required_attachments.join(", ")}.` : ""].filter(Boolean).join("\n\n");
}
