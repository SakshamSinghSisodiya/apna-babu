import { handle, pool } from "@/lib/route";
import { localize } from "@/lib/localize";
import { LANGUAGES, type LangId } from "@/lib/languages";

export const maxDuration = 60;

export const POST = handle(async (req) => {
  const { texts, lang } = (await req.json()) as { texts: string[]; lang: LangId };
  if (!Array.isArray(texts) || texts.length > 80 || !(lang in LANGUAGES)) throw new Error("bad request");
  const items = await pool(texts, 8, async (t) => {
    try {
      return await localize(String(t), lang);
    } catch {
      return { text: String(t), speak: String(t) }; // degrade to English rather than fail
    }
  });
  return { items };
});
