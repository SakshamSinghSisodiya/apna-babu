import { handle } from "@/lib/route";
import { chatJSON } from "@/lib/sarvam";

export const maxDuration = 60;

export const POST = handle(async (req) => {
  const { title, filled, missing, attachments } = await req.json();
  const r = await chatJSON<{ summary_en: string }>(
    `You are Apna Babu, a warm helper. Write a spoken closing summary in simple English, max 4 short sentences: say the form is ready, how many details were filled, name any missing details, and tell the user what to attach or carry (only from the given list), and to review before submitting. Output ONLY JSON {"summary_en":"..."}.`,
    JSON.stringify({ title, filled_count: filled, missing: (missing ?? []).slice(0, 8), attachments: (attachments ?? []).slice(0, 8) }),
    500,
  );
  return { summary_en: String(r.summary_en ?? "").slice(0, 900) };
});
