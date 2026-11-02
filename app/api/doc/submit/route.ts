import { handle } from "@/lib/route";
import { sarvamJSON } from "@/lib/sarvam";

export const maxDuration = 60;

export const POST = handle(async (req) => {
  const incoming = await req.formData();
  const file = incoming.get("file");
  if (!(file instanceof File)) throw new Error("no file");
  const data = await sarvamJSON("/doc-ai/v1/job/parse", {
    form: () => {
      const f = new FormData();
      f.append("file", file, file.name);
      return f;
    },
    timeoutMs: 50000,
  });
  return { job_id: data.job_id, status: data.status };
});
