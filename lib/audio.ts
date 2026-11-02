// Browser-only audio helpers: record -> 16 kHz mono WAV, and a single reusable player.

export class Recorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  startedAt = 0;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.startedAt = Date.now();
  }

  stop(): Promise<{ blob: Blob | null; ms: number }> {
    return new Promise((resolve) => {
      const ms = Date.now() - this.startedAt;
      if (!this.rec || this.rec.state === "inactive") return resolve({ blob: null, ms });
      this.rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        const raw = new Blob(this.chunks, { type: this.rec?.mimeType || "audio/webm" });
        resolve({ blob: (await toWav16k(raw).catch(() => null)) ?? raw, ms });
      };
      this.rec.stop();
    });
  }
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await ctx.decodeAudioData(buf);
  ctx.close();
  const length = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, length, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  w(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}

const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export class Player {
  private el?: HTMLAudioElement;
  private token = 0;

  // Must be called from a user gesture once (autoplay policy).
  unlock() {
    if (!this.el) {
      this.el = new Audio();
      this.el.src = SILENT;
      this.el.play().catch(() => {});
    }
  }

  stop() {
    this.token++;
    this.el?.pause();
  }

  async play(audios: string[]) {
    this.unlock();
    const my = ++this.token;
    for (const a of audios) {
      if (my !== this.token || !this.el) return;
      this.el.src = "data:audio/wav;base64," + a;
      await new Promise<void>((res) => {
        const el = this.el!;
        el.onended = () => res();
        el.onerror = () => res();
        el.play().catch(() => res());
      });
    }
  }
}

export async function downscaleImage(file: File, max = 1600): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
