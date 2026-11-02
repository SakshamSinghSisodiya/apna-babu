"use client";
import type { FieldValue, FormSchema } from "@/lib/types";
import type { LangId } from "@/lib/languages";
import { t } from "@/lib/i18n";

interface Props {
  schema: FormSchema;
  values: Record<string, FieldValue>;
  highlight?: string | null;
  done?: boolean;
  lang: LangId;
  letter?: string;
  onEdit?: (index: number) => void;
}

export default function FormSheet({ schema, values, highlight, done, lang, letter, onEdit }: Props) {
  const sections: { name: string; items: { idx: number; id: string; label: string }[] }[] = [];
  schema.fields.forEach((f, idx) => {
    let s = sections.find((x) => x.name === f.section);
    if (!s) sections.push((s = { name: f.section, items: [] }));
    s.items.push({ idx, id: f.id, label: f.label_form || f.label_en });
  });
  const today = new Date().toLocaleDateString("en-GB");

  return (
    <div id="print-root" className="relative mx-auto w-full max-w-[760px] rounded-sm border border-navy/20 bg-white p-5 shadow-lg sm:p-8">
      {done && (
        <div className="stamp pointer-events-none absolute right-3 top-2 rotate-[-12deg] rounded-md border-4 border-leaf px-2 py-0.5 text-base font-extrabold tracking-widest text-leaf opacity-0 sm:text-lg">
          {t(lang, "filled")}
        </div>
      )}
      <div className="mt-5 border-b-2 border-navy pb-3 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-saffron-2">{schema.is_form ? "Application / Form" : "Draft letter / application"}</div>
        <h2 className="mt-1 text-xl font-bold text-navy sm:text-2xl">{schema.title_form || schema.title}</h2>
      </div>

      {sections.map((s) => (
        <section key={s.name} className="mt-5 break-inside-avoid">
          <h3 className="mb-2 border-b border-dashed border-navy/30 pb-1 text-xs font-bold uppercase tracking-wider text-navy">{s.name}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {s.items.map((it) => {
              const v = values[it.id];
              const filled = v && !v.skipped && v.latin;
              return (
                <div
                  key={it.id}
                  onClick={() => onEdit?.(it.idx)}
                  className={`no-print-hover rounded px-1.5 py-1 ${onEdit ? "cursor-pointer hover:bg-saffron/10" : ""} ${highlight === it.id ? "fill-flash" : ""} ${it.label.length > 38 || (filled && v.latin.length > 36) ? "sm:col-span-2" : ""}`}
                >
                  <dt className="text-[11px] font-medium text-ink/60">{it.label}</dt>
                  <dd className={`min-h-[1.6rem] border-b border-ink/40 pb-0.5 text-[15px] font-semibold ${filled ? "text-navy" : "text-ink/30"}`}>
                    {filled ? v.form || v.latin : v?.skipped ? <span className="text-xs font-normal italic">— {t(lang, "missing")} —</span> : ""}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

      {letter && (
        <section className="mt-6 whitespace-pre-line rounded border border-navy/15 bg-paper/40 p-4 text-[15px] leading-relaxed text-ink">{letter}</section>
      )}

      {schema.required_attachments.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-navy">Documents to attach</h3>
          <ul className="list-inside list-disc text-sm text-ink/80">
            {schema.required_attachments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
        <div>
          <div className="border-b border-ink/50 pt-6" />
          <div className="mt-1 text-xs text-ink/60">Date: {today}</div>
        </div>
        <div>
          <div className="border-b border-ink/50 pt-6" />
          <div className="mt-1 text-xs text-ink/60">Signature / Thumb impression</div>
        </div>
      </div>
      <p className="mt-6 text-center text-[10px] text-ink/50">{t(lang, "disclaimer")}</p>
    </div>
  );
}
