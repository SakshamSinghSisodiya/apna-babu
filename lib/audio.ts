// Browser-only audio helpers: record -> 16 kHz mono WAV, and a single reusable player.

const SILENCE_MS = 3000; // a pause this long after speech ends the answer
const NO_SPEECH_MS = 25000; // nobody spoke: turn the mic off rather than listen forever
const MAX_SPEECH_MS = 28000; // Saaras takes about 30 s per clip
const MIN_SPEECH_MS = 150; // shorter sounds are clicks and bumps, not words

export type AutoStop = "silence" | "no-speech" | "too-long";

export class Recorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private watcher?: ReturnType<typeof setInterval>;
  private speech: { from: number; to: number } | null = null; // ms since startedAt
  startedAt = 0;

  // Call once from a user gesture so the level meter can run when the mic opens by itself.
  unlock() {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx ??= new Ctx();
    void this.ctx.resume();
  }

  async start(onAutoStop: (why: AutoStop) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.speech = null;
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.startedAt = Date.now();
    this.watch(onAutoStop);
  }

  // Tells speech from silence by loudness, against a noise floor that follows the room.
  private watch(onAutoStop: (why: AutoStop) => void) {
    this.unlock();
    const analyser = this.ctx!.createAnalyser();
    analyser.fftSize = 2048;
    this.source = this.ctx!.createMediaStreamSource(this.stream!);
    this.source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let floor = 0;
    let loudSince: number | null = null;
    const end = (why: AutoStop) => {
      this.unwatch();
      onAutoStop(why);
    };
    this.watcher = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / buf.length);
      floor += (rms - floor) * (rms < floor ? 0.2 : 0.005);
      const now = Date.now() - this.startedAt;
      if (rms > Math.max(0.012, floor * 2.5)) {
        loudSince ??= now;
        if (this.speech) this.speech.to = now;
        else if (now - loudSince >= MIN_SPEECH_MS) this.speech = { from: loudSince, to: now };
      } else loudSince = null;
      if (!this.speech) {
        if (now >= NO_SPEECH_MS) end("no-speech");
      } else if (now - this.speech.to >= SILENCE_MS) end("silence");
      else if (now - this.speech.from >= MAX_SPEECH_MS) end("too-long");
    }, 50);
  }

  private unwatch() {
    clearInterval(this.watcher);
    this.source?.disconnect();
    this.source = undefined;
  }

  // Sends only the speech, so a long wait before answering does not use up the STT clip limit.
  stop(): Promise<{ blob: Blob | null; ms: number; heard: boolean }> {
    return new Promise((resolve) => {
      this.unwatch();
      const ms = Date.now() - this.startedAt;
      const heard = !!this.speech;
      const range: [number, number] | null = this.speech && [Math.max(0, this.speech.from - 400), this.speech.to + 600];
      if (!this.rec || this.rec.state === "inactive") return resolve({ blob: null, ms, heard });
      this.rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        const raw = new Blob(this.chunks, { type: this.rec?.mimeType || "audio/webm" });
        resolve({ blob: (await toWav16k(raw, range, ms).catch(() => null)) ?? raw, ms, heard });
      };
      this.rec.stop();
    });
  }

  // Closes the mic and throws the audio away.
  cancel() {
    this.unwatch();
    if (this.rec) this.rec.onstop = null;
    if (this.rec?.state !== "inactive") this.rec?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

async function toWav16k(blob: Blob, rangeMs: [number, number] | null, totalMs: number): Promise<Blob> {
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
  const all = rendered.getChannelData(0);
  // The recording can start late against the clock, but it always ends at the stop: measure back from there.
  const shift = all.length / 16 - totalMs;
  const from = rangeMs ? Math.max(0, Math.floor((rangeMs[0] + shift) * 16)) : 0;
  const to = rangeMs ? Math.min(all.length, Math.ceil((rangeMs[1] + shift) * 16)) : all.length;
  const pcm = to - from >= 1600 ? all.subarray(from, to) : all;
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
  private interrupt?: () => void;

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
    this.interrupt?.();
  }

  // Resolves true when everything played to the end, false when something cut it off.
  async play(audios: string[]): Promise<boolean> {
    this.unlock();
    this.interrupt?.();
    const my = ++this.token;
    for (const a of audios) {
      if (my !== this.token || !this.el) return false;
      this.el.src = "data:audio/wav;base64," + a;
      await new Promise<void>((res) => {
        const el = this.el!;
        this.interrupt = res;
        el.onended = () => res();
        el.onerror = () => res();
        el.play().catch(() => res());
      });
    }
    return my === this.token;
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
