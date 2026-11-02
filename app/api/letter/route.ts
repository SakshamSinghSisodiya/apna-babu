import { handle } from "@/lib/route";
import { chatJSON } from "@/lib/sarvam";

export const maxDuration = 60;

// For notices and bills, the result is an actual letter built from the answers, not just a list of them.
export const POST = handle(async (req) => {
  const { title, summary, details } = await req.json();
  const r = await chatJSON<{ letter_en: string }>(
    `You draft short, polite, formal letters in simple English for Indian citizens writing to a government office, bank or utility. Write the body of the requested document using ONLY the facts given; do not invent names, dates, amounts, laws or section numbers. Leave out anything not given. Use plain paragraphs separated by a blank line, starting with "To," and the addressee if known, then "Subject:", then the body, ending with "Yours faithfully," and the applicant's name. Max 200 words. Output ONLY JSON {"letter_en":"..."}.`,
    JSON.stringify({ document: title, about_the_original_document: summary, details }),
    900,
  );
  return { letter_en: String(r.letter_en ?? "").slice(0, 3000) };
});
