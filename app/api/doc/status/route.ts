import { handle } from "@/lib/route";
import { sarvamJSON } from "@/lib/sarvam";

export const maxDuration = 30;

export const GET = handle(async (req) => {
  const id = new URL(req.url).searchParams.get("job_id");
  if (!id || !/^[\w-]+$/.test(id)) throw new Error("bad id");
  const d = await sarvamJSON(`/doc-ai/v1/job/${id}/status`);
  return { status: d.status, usage: d.usage };
});
