import { handle } from "@/lib/route";
import { transliterateText } from "@/lib/sarvam";

export const maxDuration = 30;

export const POST = handle(async (req) => {
  const { text, from, to } = await req.json();
  return { text: await transliterateText(String(text), from, to) };
});
