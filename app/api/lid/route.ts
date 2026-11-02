import { handle } from "@/lib/route";
import { sarvamJSON } from "@/lib/sarvam";
import { langFromLid } from "@/lib/languages";

export const maxDuration = 15;

export const POST = handle(async (req) => {
  const { text } = await req.json();
  const d = await sarvamJSON("/text-lid", { json: { input: String(text).slice(0, 900) }, timeoutMs: 8000 });
  return { language_code: d.language_code, script_code: d.script_code, lang: langFromLid(d.language_code, d.script_code) };
});
