import { handle } from "@/lib/route";
import { sarvamJSON } from "@/lib/sarvam";

export const maxDuration = 30;

interface Block {
  text?: string;
  layout_tag?: string;
  reading_order?: number;
}

// Parse jobs produce HTML, so format=md is refused; the default JSON has every text block with its reading order.
function toMarkdown(data: { documents?: { pages?: { blocks?: Block[] }[] }[] }): string {
  const pages = (data.documents ?? []).flatMap((d) => d.pages ?? []);
  return pages
    .map((p) =>
      [...(p.blocks ?? [])]
        .sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0))
        .map((b) => (b.text ?? "").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("job_id");
  if (!id || !/^[\w-]+$/.test(id)) throw new Error("bad id");
  const data = await sarvamJSON(`/doc-ai/v1/job/${id}/results`);
  return { markdown: toMarkdown(data).slice(0, 20000) };
});
