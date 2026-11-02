import { NextResponse } from "next/server";
import { errorStatus } from "./sarvam";

// Wrap handlers so a failure is always a friendly JSON error, never a stack trace.
export function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      return NextResponse.json(await fn(req));
    } catch (e) {
      console.error("route error:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
      return NextResponse.json({ error: "temporarily_unavailable" }, { status: errorStatus(e) });
    }
  };
}

export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
