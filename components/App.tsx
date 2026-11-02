"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import FormSheet from "./FormSheet";
import { Player, Recorder, downscaleImage } from "@/lib/audio";
import { LANG_LIST, LANGUAGES, type LangId } from "@/lib/languages";
import { CONFIRM_TMPL, GREETING, MISC, t } from "@/lib/i18n";
import { SAMPLES } from "@/lib/samples";
import { quickIntent, speakableValue } from "@/lib/validate";
import type { AnswerResult, FieldLoc, FieldValue, FormSchema, Localized } from "@/lib/types";

type Phase = "upload" | "reading" | "lang" | "preparing" | "chat" | "done";
interface Msg {
  id: number;
  from: "babu" | "user";
  text: string;
  speak?: string;
  lang: LangId;
}

async function api<T = any>(url: string, body?: unknown, form?: FormData): Promise<T> {
  const r = await fetch(
    url,
    form ? { method: "POST", body: form } : body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined,
  );
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nextUnresolved(schema: FormSchema, values: Record<string, FieldValue>): number {
  return schema.fields.findIndex((f) => !values[f.id]);
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [lang, setLang] = useState<LangId>("en");
  const [loc, setLoc] = useState<FieldLoc[]>([]);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<"asking" | "confirming">("asking");
  const [pending, setPending] = useState<FieldValue | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState<null | "thinking">(null);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [lidSuggest, setLidSuggest] = useState<LangId | null>(null);
  const [typed, setTyped] = useState("");
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [readStep, setReadStep] = useState(0);
  const [readSecs, setReadSecs] = useState(0);
  const [pasteText, setPasteText] = useState("");
  const [sharedNote, setSharedNote] = useState("");
  const [letter, setLetter] = useState("");

  const live = useRef({ schema, lang, loc, values, idx, stage, pending, phase, busy, micDenied });
  live.current = { schema, lang, loc, values, idx, stage, pending, phase, busy, micDenied };
  const player = useRef<Player | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const recordingRef = useRef(false);
  const recStarting = useRef(false);
  const recToken = useRef(0);
  const typingRef = useRef(false); // the user reached for the keyboard: leave the mic off
  const listenAfterSpeech = useRef<(seq: number) => void>(() => {});
  const ttsCache = useRef(new Map<string, string[]>());
  const msgId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const speakSeq = useRef(0);
  const session = useRef(0); // bumped by "start over" so late replies from the old form are ignored
  const lastFile = useRef<File | null>(null);

  const getPlayer = () => (player.current ??= new Player());

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (phase !== "reading") return;
    const id = setInterval(() => setReadSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    document.documentElement.lang = LANGUAGES[lang].code;
  }, [lang]);

  // ---------- speech ----------
  const speak = useCallback(async (text: string, lng: LangId, force = false) => {
    if (!text.trim() || (!force && recordingRef.current)) return;
    const seq = ++speakSeq.current;
    try {
      const key = lng + "|" + text;
      let audios = ttsCache.current.get(key);
      if (!audios) {
        audios = (await api<{ audios: string[] }>("/api/tts", { text, lang: lng })).audios;
        ttsCache.current.set(key, audios);
      }
      if (seq !== speakSeq.current || (!force && recordingRef.current)) return; // a newer line, or the user started talking
      setSpeaking(true);
      const finished = await getPlayer().play(audios);
      if (seq !== speakSeq.current) return;
      setSpeaking(false);
      if (!finished) return;
    } catch {
      /* text is already on screen; voice is a bonus */
      if (seq !== speakSeq.current) return;
      setSpeaking(false);
    }
    listenAfterSpeech.current(seq);
  }, []);

  const pushBabu = useCallback(
    (text: string, lng: LangId, spk?: string, autoplay = true) => {
      setMsgs((m) => [...m, { id: ++msgId.current, from: "babu", text, speak: spk, lang: lng }]);
      if (autoplay) void speak(spk ?? text, lng);
    },
    [speak],
  );
  const pushUser = (text: string, lng: LangId) => setMsgs((m) => [...m, { id: ++msgId.current, from: "user", text, lang: lng }]);

  const translateMany = async (texts: string[], lng: LangId): Promise<Localized[]> => {
    if (lng === "en") return texts.map((x) => ({ text: x, speak: x }));
    try {
      const half = Math.ceil(texts.length / 2);
      const parts = texts.length > 24 ? [texts.slice(0, half), texts.slice(half)] : [texts];
      const res = await Promise.all(parts.map((p) => api<{ items: Localized[] }>("/api/translate", { texts: p, lang: lng })));
      return res.flatMap((r) => r.items);
    } catch {
      return texts.map((x) => ({ text: x, speak: x }));
    }
  };

  // ---------- document reading ----------
  const processMarkdown = async (markdown: string) => {
    setReadStep(2);
    const sch = await api<FormSchema>("/api/schema", { markdown });
    setSchema(sch);
    setPhase("lang");
    void speak(GREETING.hinglish, "hinglish", true);
  };

  const processFile = async (file: File) => {
    const gen = session.current;
    let step: "read" | "understand" = "read";
    lastFile.current = file;
    getPlayer().unlock();
    setUploadErr(null);
    setPhase("reading");
    setReadStep(0);
    setReadSecs(0);
    try {
      const f = await downscaleImage(file).catch(() => file);
      if (f.size > 4_200_000) throw new Error("big");
      const fd = new FormData();
      fd.append("file", f);
      setReadStep(1);
      const { job_id } = await api<{ job_id: string }>("/api/doc/submit", undefined, fd);
      const t0 = Date.now();
      let ok = false;
      while (Date.now() - t0 < 85000) {
        await sleep(2000);
        if (gen !== session.current) return;
        const s = await api<{ status: string }>(`/api/doc/status?job_id=${job_id}`).catch(() => ({ status: "retry" })); // one failed poll is not a failed job
        if (s.status === "completed" || s.status === "partially_completed") {
          ok = true;
          break;
        }
        if (s.status === "failed" || s.status === "rejected") throw new Error("failed");
      }
      if (!ok) throw new Error("timeout");
      const { markdown } = await api<{ markdown: string }>(`/api/doc/result?job_id=${job_id}`);
      if (gen !== session.current) return;
      step = "understand";
      await processMarkdown(markdown);
    } catch (e) {
      if (gen !== session.current) return;
      setPhase("upload");
      const why = e instanceof Error ? e.message : "";
      setUploadErr(
        why === "big"
          ? "That file is too large (max about 4 MB). Try a smaller photo, or use a sample form."
          : why === "timeout"
            ? "This document is taking too long to read. Try a photo of just the first page, paste its text below, or use a sample form."
            : step === "understand"
              ? "Babu read this document but could not work out what it needs. Try again, paste the important part below, or use a sample form."
              : "Babu could not read this document. Try a clearer photo, paste its text below, or use a sample form.",
      );
    }
  };

  const processPaste = async () => {
    getPlayer().unlock();
    setUploadErr(null);
    setPhase("reading");
    setReadStep(2);
    setReadSecs(0);
    try {
      await processMarkdown(pasteText);
    } catch {
      setPhase("upload");
      setUploadErr("Babu could not understand that text. Please paste more of the document, or use a sample form.");
    }
  };

  const useSample = (id: string) => {
    getPlayer().unlock();
    const s = SAMPLES.find((x) => x.id === id)!;
    setUploadErr(null);
    setSchema(s.schema);
    setPhase("lang");
    void speak(GREETING.hinglish, "hinglish", true);
  };

  // ---------- conversation ----------
  const prepare = async (sch: FormSchema, lng: LangId) => {
    const pre = sch.fields.filter((f) => f.prefilled_value).length;
    const n = sch.fields.length - pre;
    const intro =
      (sch.is_form ? "" : `This is not a form, but I can help you respond to it with a ${sch.title}. `) +
      `${sch.summary_en} I will ask you ${n} question${n === 1 ? "" : "s"}, one by one. You can speak or type your answers. Let's begin.`;
    const texts = [intro, ...sch.fields.flatMap((f) => [f.question_en, f.label_en])];
    const out = await translateMany(texts, lng);
    const locs: FieldLoc[] = sch.fields.map((_, i) => ({ question: out[1 + i * 2], label: out[2 + i * 2].text }));
    return { introLoc: out[0], locs };
  };

  const ask = (i: number, c: { lang: LangId; loc: FieldLoc[] }, prefix?: Localized) => {
    setIdx(i);
    setStage("asking");
    setPending(null);
    const q = c.loc[i].question;
    const text = prefix ? `${prefix.text} ${q.text}` : q.text;
    const spk = (prefix ? `${prefix.speak} ${q.speak}` : q.speak) || text;
    pushBabu(text, c.lang, spk, true);
  };

  const chooseLang = async (lng: LangId) => {
    if (!schema) return;
    getPlayer().unlock();
    getPlayer().stop();
    (recorder.current ??= new Recorder()).unlock();
    typingRef.current = false;
    const gen = session.current;
    setLang(lng);
    setPhase("preparing");
    const { introLoc, locs } = await prepare(schema, lng);
    if (gen !== session.current) return;
    const vals: Record<string, FieldValue> = {};
    schema.fields.forEach((f) => {
      if (f.prefilled_value) vals[f.id] = { value: f.prefilled_value, latin: f.prefilled_value };
    });
    setLoc(locs);
    setValues(vals);
    setMsgs([]);
    setPhase("chat");
    const first = nextUnresolved(schema, vals);
    setMsgs((m) => [...m, { id: ++msgId.current, from: "babu", text: introLoc.text, speak: introLoc.speak, lang: lng }]);
    if (first < 0) return void finish(vals, lng, locs);
    setIdx(first);
    setStage("asking");
    const q = locs[first].question;
    setMsgs((m) => [...m, { id: ++msgId.current, from: "babu", text: q.text, speak: q.speak, lang: lng }]);
    void speak(`${introLoc.speak} ${q.speak}`, lng);
  };

  const switchLang = async (lng: LangId) => {
    const L = live.current;
    if (!L.schema) return;
    cancelRec();
    setLidSuggest(null);
    setBusy("thinking");
    const { locs } = await prepare(L.schema, lng);
    setLang(lng);
    setLoc(locs);
    setBusy(null);
    ask(L.idx, { lang: lng, loc: locs });
  };

  const finish = async (vals: Record<string, FieldValue>, lng: LangId, _locs: FieldLoc[]) => {
    const L = live.current;
    const sch = L.schema!;
    const gen = session.current;
    setPhase("done");
    setStage("asking");
    setShowForm(true);
    const filled = sch.fields.filter((f) => vals[f.id] && !vals[f.id].skipped).length;
    const missing = sch.fields.filter((f) => !vals[f.id] || vals[f.id].skipped).map((f) => f.label_en);
    setBusy("thinking");
    let en = `Your ${sch.title} is ready with ${filled} details filled.${missing.length ? ` Still missing: ${missing.join(", ")}.` : ""} Please review it before submitting.`;
    try {
      en = (await api<{ summary_en: string }>("/api/summary", { title: sch.title, filled, missing, attachments: sch.required_attachments })).summary_en || en;
    } catch {}
    if (!sch.is_form) {
      const details = sch.fields.filter((f) => vals[f.id] && !vals[f.id].skipped).map((f) => ({ label: f.label_en, value: vals[f.id].latin }));
      await api<{ letter_en: string }>("/api/letter", { title: sch.title, summary: sch.summary_en, details })
        .then((r) => setLetter(r.letter_en))
        .catch(() => {});
    }
    const [loc1] = await translateMany([en], lng);
    if (gen !== session.current) return;
    setBusy(null);
    pushBabu(loc1.text, lng, loc1.speak);
  };

  const commit = (p: FieldValue) => {
    const L = live.current;
    const f = L.schema!.fields[L.idx];
    const vals = { ...L.values, [f.id]: p };
    setValues(vals);
    setHighlight(f.id);
    setTimeout(() => setHighlight((h) => (h === f.id ? null : h)), 2000);
    const next = nextUnresolved(L.schema!, vals);
    if (next < 0) void finish(vals, L.lang, L.loc);
    else ask(next, { lang: L.lang, loc: L.loc });
  };

  const skipField = () => {
    const L = live.current;
    const f = L.schema!.fields[L.idx];
    const vals = { ...L.values, [f.id]: { value: "", latin: "", skipped: true } };
    setValues(vals);
    const m = MISC[L.lang].skipped;
    const next = nextUnresolved(L.schema!, vals);
    if (next < 0) {
      pushBabu(m, L.lang);
      void finish(vals, L.lang, L.loc);
    } else ask(next, { lang: L.lang, loc: L.loc }, { text: m, speak: m });
  };

  const showConfirm = (p: FieldValue) => {
    const L = live.current;
    const f = L.schema!.fields[L.idx];
    setPending(p);
    setStage("confirming");
    const display = L.lang === "hi" || L.lang === "mr" ? p.value || p.latin : p.latin;
    const label = L.loc[L.idx].label;
    const build = (v: string) => CONFIRM_TMPL[L.lang].replace("{label}", label).replace("{value}", v);
    pushBabu(build(display), L.lang, build(speakableValue(f.type, display)));
  };

  const reask = () => {
    const L = live.current;
    ask(L.idx, { lang: L.lang, loc: L.loc }, { text: MISC[L.lang].again, speak: MISC[L.lang].again });
  };

  const lidCheck = async (text: string, type: string) => {
    if (["phone", "pincode", "number", "date", "email"].includes(type) || text.trim().split(/\s+/).length < 3) return;
    try {
      const r = await api<{ lang: LangId | null }>("/api/lid", { text });
      const cur = live.current.lang;
      const d = r.lang;
      if (!d || d === cur || (d === "hi" && cur === "hinglish") || (d === "hinglish" && cur === "hi")) return;
      // Names and addresses say little about the language being spoken: only trust a change of script.
      if ((type === "name" || type === "address") && !((cur === "en" || cur === "hinglish") && (d === "hi" || d === "mr"))) return;
      setLidSuggest(d);
    } catch {}
  };

  const handleInput = async (raw: string, display?: string, native?: string) => {
    const text = raw.trim();
    const L = live.current;
    if (!text || !L.schema || L.phase !== "chat") return;
    getPlayer().stop();
    speakSeq.current++;
    setSpeaking(false);
    pushUser(display ?? text, L.lang);
    setBusy("thinking");
    const f = L.schema.fields[L.idx];
    try {
      if (L.stage === "confirming" && L.pending) {
        const q = quickIntent(text);
        if (q === "yes") commit(L.pending);
        else if (q === "skip") skipField();
        else if (q === "no") reask();
        else {
          const r = await api<AnswerResult>("/api/answer", { field: f, transcript: text, lang: L.lang, stage: "confirm", current: L.pending.latin, form_language: L.schema.form_language });
          if (r.intent === "yes") commit(L.pending);
          else if (r.intent === "skip") skipField();
          else if (r.intent === "answer" && r.valid && (r.value || r.value_latin)) showConfirm({ value: r.value, latin: r.value_latin, form: r.value_form });
          else reask();
        }
      } else {
        if (quickIntent(text) === "skip") return skipField();
        void lidCheck(native || text, f.type);
        const r = await api<AnswerResult>("/api/answer", { field: f, transcript: text, lang: L.lang, stage: "answer", form_language: L.schema.form_language });
        if (r.intent === "skip") return skipField();
        // The model sometimes rejects a bad value with intent "unknown": its explanation still beats "please repeat".
        if (!r.valid && (r.problem_en || r.intent === "answer")) {
          const [prob] = await translateMany([r.problem_en || "That does not look right."], L.lang);
          const q = L.loc[L.idx].question;
          return void pushBabu(`${prob.text} ${q.text}`, L.lang, `${prob.speak} ${q.speak}`);
        }
        if (r.intent !== "answer" || !(r.value || r.value_latin)) return void pushBabu(MISC[L.lang].unclear, L.lang);
        showConfirm({ value: r.value, latin: r.value_latin, form: r.value_form });
      }
    } catch {
      pushBabu(MISC[L.lang].error, L.lang);
    } finally {
      setBusy(null);
    }
  };

  const editField = (i: number) => {
    const L = live.current;
    if (!L.schema || busy || (L.phase !== "chat" && L.phase !== "done")) return;
    cancelRec();
    setPhase("chat");
    setShowForm(false);
    ask(i, { lang: L.lang, loc: L.loc });
  };

  // ---------- microphone ----------
  const startRec = async () => {
    if (recordingRef.current || recStarting.current) return;
    recStarting.current = true;
    const token = ++recToken.current;
    getPlayer().stop();
    speakSeq.current++;
    setSpeaking(false);
    try {
      recorder.current ??= new Recorder();
      await recorder.current.start((why) => (why === "no-speech" ? cancelRec() : void stopRec()));
      if (token !== recToken.current) return recorder.current.cancel();
      recordingRef.current = true;
      setRecording(true);
    } catch {
      if (token === recToken.current) setMicDenied(true);
    } finally {
      recStarting.current = false;
    }
  };

  // Closes the mic without sending anything, for when the user answers some other way.
  const cancelRec = () => {
    recToken.current++;
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    recorder.current?.cancel();
  };

  const stopRec = async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setBusy("thinking");
    const L = live.current;
    let heard = false;
    try {
      const rec = await recorder.current!.stop();
      const { blob, ms } = rec;
      heard = rec.heard;
      // Done tapped with nothing said: that means "mic off", so don't ask again and reopen it.
      const nothingSaid = () => heard && pushBabu(MISC[L.lang].unclear, L.lang);
      if (!blob || ms < 500) {
        nothingSaid();
        return;
      }
      const fd = new FormData();
      fd.append("audio", blob, "speech.wav");
      fd.append("lang", L.lang);
      const r = await api<{ transcript: string; display: string; native: string }>("/api/stt", undefined, fd);
      if (!r.transcript.trim()) {
        nothingSaid();
        return;
      }
      setBusy(null);
      await handleInput(r.transcript, r.display, r.native);
    } catch {
      if (heard) pushBabu(MISC[L.lang].error, L.lang);
    } finally {
      setBusy(null);
    }
  };

  const onMicTap = () => {
    typingRef.current = false;
    void (recordingRef.current ? stopRec() : startRec());
  };

  // The short wait lets the end of Babu's voice die away before the mic opens.
  listenAfterSpeech.current = (seq) => {
    setTimeout(() => {
      const L = live.current;
      if (seq !== speakSeq.current || L.phase !== "chat" || L.busy || L.micDenied || typingRef.current) return;
      void startRec();
    }, 250);
  };

  const onTyping = () => {
    typingRef.current = true;
    cancelRec();
  };

  // ---------- result actions ----------
  const resultText = () => {
    const sch = schema!;
    const rows = sch.fields.map((f) => `${f.label_form || f.label_en}: ${values[f.id] && !values[f.id].skipped ? values[f.id].form || values[f.id].latin : "________"}`);
    return `${sch.title_form || sch.title}\n\n${rows.join("\n")}\n\n${letter ? letter + "\n\n" : ""}${t(lang, "disclaimer")}\n— Apna Babu`;
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([resultText()], { type: "text/plain;charset=utf-8" }));
    a.download = `${(schema!.doc_type || "form").replace(/[^\w-]/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: schema!.title, text: resultText() });
      else {
        await navigator.clipboard.writeText(resultText());
        setSharedNote(t(lang, "copied"));
        setTimeout(() => setSharedNote(""), 2000);
      }
    } catch {}
  };
  const startOver = () => {
    if (phase === "chat" && !window.confirm(t(lang, "confirmOver"))) return;
    session.current++;
    getPlayer().stop();
    cancelRec();
    speakSeq.current++;
    typingRef.current = false;
    lastFile.current = null;
    setSpeaking(false);
    setBusy(null);
    setLidSuggest(null);
    setLang("en");
    setPhase("upload");
    setSchema(null);
    setValues({});
    setMsgs([]);
    setLoc([]);
    setShowForm(false);
    setUploadErr(null);
    setPasteText("");
    setLetter("");
  };

  const total = schema?.fields.length ?? 0;
  const filledCount = schema ? schema.fields.filter((f) => values[f.id] && !values[f.id].skipped).length : 0;
  const lastBabuId = [...msgs].reverse().find((m) => m.from === "babu")?.id;

  const actionsBar = (className = "") => (
    <div className={`no-print flex flex-wrap gap-2 ${className}`}>
      <button onClick={() => window.print()} className="rounded-lg bg-navy px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-navy-2">🖨️ {t(lang, "print")}</button>
      <button onClick={download} className="rounded-lg border border-navy/30 bg-white px-3 py-2.5 text-sm font-semibold text-navy hover:bg-paper-2">⬇️ {t(lang, "download")}</button>
      <button onClick={share} className="rounded-lg border border-navy/30 bg-white px-3 py-2.5 text-sm font-semibold text-navy hover:bg-paper-2">📤 {sharedNote || t(lang, "share")}</button>
      <button onClick={startOver} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-ink/60 hover:text-ink">↺ {t(lang, "startOver")}</button>
    </div>
  );

  // =============== RENDER ===============
  const header = (
    <header className="no-print sticky top-0 z-40 flex items-center justify-between border-b-4 border-saffron bg-navy px-4 py-2.5 text-white">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-paper text-xl">🧑‍💼</span>
        <div className="leading-tight">
          <div className="text-lg font-extrabold tracking-tight">Apna Babu</div>
          <div className="hidden text-[11px] text-white/70 sm:block">the government clerk who works for you</div>
        </div>
      </div>
      {phase !== "upload" && phase !== "reading" && (
        <div className="flex items-center gap-2">
          {phase !== "lang" && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">{LANGUAGES[lang].label}</span>}
          <button onClick={startOver} title={t(lang, "startOver")} aria-label={t(lang, "startOver")} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20">↺</button>
        </div>
      )}
    </header>
  );

  if (phase === "upload" || phase === "reading") {
    const steps = ["Uploading your document", "Sarvam Vision is reading it", "Babu is understanding the form"];
    return (
      <div className="min-h-dvh">
        {header}
        <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
          <div className="text-center">
            <h1 className="text-3xl font-extrabold leading-tight text-navy sm:text-5xl">Every Indian has paid a tout to fill a form.</h1>
            <p className="mt-3 text-lg font-semibold text-saffron-2 sm:text-2xl">Apna Babu does it free, in your language.</p>
            <p className="mt-2 text-sm text-ink/60">English · हिंदी · मराठी · Hinglish — just speak, Babu fills the form.</p>
          </div>

          {phase === "reading" ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-navy/15 bg-white p-6 shadow">
              <div className="mb-4 flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-saffron border-t-transparent" />
                <div className="font-bold text-navy">Reading your document… {readSecs}s</div>
              </div>
              <ol className="space-y-2 text-sm">
                {steps.map((s, i) => (
                  <li key={s} className={`flex items-center gap-2 ${i <= readStep ? "text-ink" : "text-ink/30"}`}>
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-navy/10 text-[11px]">{i < readStep ? "✓" : i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <label className="mt-8 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-navy/40 bg-white/70 px-6 py-8 text-center transition hover:border-saffron hover:bg-white">
                <span className="text-4xl">📄</span>
                <span className="text-lg font-bold text-navy">Upload a form or official letter</span>
                <span className="text-sm text-ink/60">Photo (JPG / PNG) or PDF — notice, bill, summons, bank letter, any form</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // so picking the same file again after a failure still fires
                    if (file) void processFile(file);
                  }} />
              </label>

              {uploadErr && (
                <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                  <p>{uploadErr}</p>
                  {lastFile.current && <button onClick={() => processFile(lastFile.current!)} className="mt-3 rounded-lg bg-navy px-4 py-2 font-semibold text-white">↻ Try again</button>}
                  <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the text of the document here…" className="mt-3 h-24 w-full rounded-lg border border-red-200 bg-white p-2 text-ink" />
                  <button disabled={pasteText.trim().length < 20} onClick={processPaste} className="mt-2 rounded-lg bg-navy px-4 py-2 font-semibold text-white disabled:opacity-40">Use this text</button>
                </div>
              )}

              <div className="mt-8 text-center text-xs font-bold uppercase tracking-widest text-ink/50">or try a sample form</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {SAMPLES.map((s) => (
                  <button key={s.id} onClick={() => useSample(s.id)} className="rounded-2xl border border-navy/15 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-saffron hover:shadow-md">
                    <div className="text-3xl">{s.emoji}</div>
                    <div className="mt-2 font-bold text-navy">{s.name}</div>
                    <div className="text-xs text-ink/60">{s.blurb} · {s.schema.fields.length} details</div>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="mt-10 text-center text-xs text-ink/50">Nothing is stored on our servers. Powered by Sarvam AI.</p>
        </main>
      </div>
    );
  }

  if (phase === "lang" || phase === "preparing") {
    return (
      <div className="min-h-dvh">
        {header}
        <main className="mx-auto max-w-2xl px-4 py-8 text-center sm:py-12">
          <div className="text-6xl">🧑‍💼</div>
          <h2 className="mt-3 text-2xl font-extrabold text-navy sm:text-3xl">Namaste! Which language are you comfortable in?</h2>
          <p className="mt-1 text-ink/60">आप किस भाषा में बात करेंगे? · तुम्ही कोणती भाषा वापरणार?</p>
          <div className="mx-auto mt-5 max-w-md rounded-xl border border-navy/15 bg-white p-4 text-left text-sm shadow-sm">
            <div className="font-bold text-navy">{schema?.title}</div>
            <div className="mt-1 text-ink/70">{schema?.summary_en}</div>
            {schema && !schema.is_form && <div className="mt-2 rounded bg-saffron/15 px-2 py-1 text-xs font-semibold text-saffron-2">This is a letter/notice, so Babu will help you write a reply document.</div>}
          </div>
          {phase === "preparing" ? (
            <div className="mt-10 flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-saffron border-t-transparent" />
              <div className="font-semibold text-navy">{t(lang, "preparing")}</div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4">
              {LANG_LIST.map((l) => (
                <button key={l.id} onClick={() => chooseLang(l.id)} className="rounded-2xl border-2 border-navy bg-white px-4 py-8 text-3xl font-extrabold text-navy shadow transition hover:-translate-y-0.5 hover:bg-navy hover:text-white active:scale-95 sm:py-10 sm:text-4xl">
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // ---------- chat / done ----------
  const done = phase === "done";
  return (
    <div className="flex h-dvh flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* LEFT: chat */}
        <section className="no-print flex min-h-0 min-w-0 flex-col border-r border-navy/10">
          <div className="border-b border-navy/10 bg-white/70 px-4 py-2">
            <div className="mb-1 flex justify-between text-xs font-bold text-navy">
              <span>{filledCount} / {total} {t(lang, "details")}</span>
              {done && <span className="text-leaf">{t(lang, "done")} ✓</span>}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-navy/10">
              <div className="h-full rounded-full bg-gradient-to-r from-saffron to-leaf transition-all duration-500" style={{ width: `${total ? (filledCount / total) * 100 : 0}%` }} />
            </div>
          </div>

          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
            {msgs.map((m) => (
              <div key={m.id} className={`bubble-in flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                {m.from === "babu" && <span className="mr-2 mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy text-base">🧑‍💼</span>}
                <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${m.from === "babu" ? "rounded-tl-sm bg-white text-ink" : "rounded-tr-sm bg-navy text-white"}`}>
                  {m.text}
                  {m.from === "babu" && (
                    <button onClick={() => (cancelRec(), speak(m.speak ?? m.text, m.lang, true))} title={t(lang, "replay")} aria-label={t(lang, "replay")} className="ml-2 align-middle text-base opacity-60 hover:opacity-100">🔊</button>
                  )}
                  {m.id === lastBabuId && stage === "confirming" && !busy && !done && (
                    <>
                      {pending && (pending.form || pending.latin) !== (lang === "hi" || lang === "mr" ? pending.value || pending.latin : pending.latin) && (
                        <div className="mt-2 rounded-lg bg-paper-2 px-2.5 py-1.5 text-sm">
                          <span className="text-ink/60">📝 {t(lang, "onForm")}:</span> <span className="font-semibold text-navy">{pending.form || pending.latin}</span>
                        </div>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => pending && (cancelRec(), pushUser(t(lang, "yes"), lang), commit(pending))} className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-bold text-white">✅ {t(lang, "yes")}</button>
                        <button onClick={() => (cancelRec(), pushUser(t(lang, "no"), lang), reask())} className="rounded-lg bg-saffron px-3 py-1.5 text-sm font-bold text-white">✏️ {t(lang, "no")}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-ink/60">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-navy">🧑‍💼</span>
                <span className="rounded-2xl bg-white px-4 py-2 shadow-sm">
                  {t(lang, "thinking")} <span className="dot">.</span><span className="dot">.</span><span className="dot">.</span>
                </span>
              </div>
            )}
          </div>

          {lidSuggest && !done && (
            <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl border border-saffron bg-saffron/15 px-3 py-2 text-sm">
              <span>🌐 {t(lang, "switchTo", { lang: LANGUAGES[lidSuggest].label })}</span>
              <span className="flex gap-1">
                <button onClick={() => switchLang(lidSuggest)} className="rounded-lg bg-navy px-3 py-1 font-bold text-white">{t(lang, "switchBtn")}</button>
                <button onClick={() => setLidSuggest(null)} className="rounded-lg px-2 py-1 text-ink/60">✕</button>
              </span>
            </div>
          )}

          {done ? (
            <div className="border-t border-navy/10 bg-white/80 p-3 lg:hidden">
              {actionsBar()}
              <button onClick={() => setShowForm(true)} className="mt-2 w-full rounded-lg bg-saffron px-4 py-2.5 font-bold text-white lg:hidden">{t(lang, "viewForm")} ({filledCount}/{total})</button>
            </div>
          ) : (
            <div className="border-t border-navy/10 bg-white/80 px-3 pb-3 pt-2">
              <div className="mb-2 flex gap-2 lg:hidden">
                <button onClick={() => setShowForm(true)} className="flex-1 rounded-lg border border-navy/20 bg-paper py-1.5 text-sm font-semibold text-navy">📋 {t(lang, "viewForm")} ({filledCount}/{total})</button>
                <button disabled={!!busy} onClick={() => (cancelRec(), skipField())} className="rounded-lg border border-navy/20 px-3 py-1.5 text-sm font-semibold text-navy sm:hidden">{t(lang, "skip")}</button>
              </div>
              {micDenied && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{t(lang, "micDenied")}</p>}
              {!micDenied && (recording || speaking) && (
                <p className="mb-2 text-center text-xs font-semibold text-navy" aria-live="polite">
                  {recording ? <>🔴 {t(lang, "listening")} <span className="font-normal text-ink/60">{t(lang, "autoSend")}</span></> : <>🔊 {t(lang, "speaking")}</>}
                </p>
              )}
              <div className="flex items-center gap-2">
                {!micDenied && (
                  <div className="flex w-20 shrink-0 flex-col items-center">
                    <button
                      disabled={!!busy}
                      onClick={onMicTap}
                      aria-label={recording ? t(lang, "stopTalking") : t(lang, "tapToTalk")}
                      className={`grid h-16 w-16 select-none place-items-center rounded-full text-3xl text-white shadow-lg transition disabled:opacity-40 ${recording ? "rec-pulse bg-red-600" : "bg-navy hover:bg-navy-2"}`}
                    >
                      {recording ? "⏹️" : "🎙️"}
                    </button>
                    <span className="mt-1 text-center text-[10px] font-semibold leading-tight text-ink/60">{recording ? t(lang, "stopTalking") : t(lang, "tapToTalk")}</span>
                  </div>
                )}
                <form
                  className="flex min-w-0 flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = typed;
                    setTyped("");
                    typingRef.current = false;
                    void handleInput(v);
                  }}
                >
                  <input aria-label={t(lang, "typeHere")} value={typed} disabled={!!busy} onFocus={onTyping} onChange={(e) => (onTyping(), setTyped(e.target.value))} placeholder={t(lang, "typeHere")} className="min-w-0 flex-1 rounded-xl border border-navy/25 bg-white px-3 py-3 text-[15px] outline-none focus:border-saffron" />
                  <button disabled={!typed.trim() || !!busy} className="rounded-xl bg-saffron px-4 font-bold text-white disabled:opacity-40">{t(lang, "send")}</button>
                </form>
                <button disabled={!!busy} onClick={() => (cancelRec(), skipField())} className="hidden rounded-xl border border-navy/25 px-3 py-3 text-sm font-semibold text-navy sm:block">{t(lang, "skip")}</button>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT: live form */}
        <section className={`${showForm ? "fixed inset-0 z-50 flex" : "hidden"} print-force min-h-0 min-w-0 flex-col overflow-y-auto bg-paper-2 p-3 sm:p-6 lg:static lg:z-auto lg:flex`}>
          <div className="no-print mb-3 flex items-center justify-between lg:hidden">
            <button onClick={() => setShowForm(false)} className="rounded-lg bg-navy px-4 py-2 text-sm font-bold text-white">← {t(lang, "close")}</button>
            <span className="text-sm font-bold text-navy">{filledCount} / {total}</span>
          </div>
          {done && actionsBar("mb-4")}
          {schema && <FormSheet schema={schema} values={values} highlight={highlight} done={done} lang={lang} letter={letter} onEdit={editField} />}
        </section>
      </div>
    </div>
  );
}
