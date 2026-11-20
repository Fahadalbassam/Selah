"use client";

import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonPicker } from "@/components/person-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-dialog";
import { noteAfterChoosing, reportTemplate, REPORT_TEMPLATES, templateFill, type ReportLang, type ReportTemplateId, type TemplateCounts } from "@/lib/report-templates";
import { useDialogControl, type DialogControl } from "@/hooks/use-dialog-control";

export interface Field {
  name: string;
  label: string;
  /** "person" is a searchable list of people (Combobox); options may carry a hint such as the email. */
  type?: "text" | "textarea" | "select" | "date" | "person";
  required?: boolean;
  maxLength?: number;
  dir?: "rtl" | "ltr";
  options?: { value: string; label: string; hint?: string }[];
  /** Placeholder (for a date field, also its empty label). */
  placeholder?: string;
  /** The current value, when the dialog edits something. A select with "" starts on its placeholder. */
  defaultValue?: string;
  /** A short line under the field. */
  hint?: string;
  /** An optional "person" field: offer a clear button. */
  clearable?: boolean;
  /**
   * A textarea that can start from a report template (None / Monthly progress /
   * Steering summary / Closing summary). The outline fills the note; the person
   * edits freely, and a note that already has text is replaced only after a yes.
   * The period comes from the form's own date fields (`periodFields`) or is fixed;
   * counts are used only when the period ends on `countsAsOf` (the day they are as of).
   */
  template?: {
    lang: ReportLang;
    periodFields?: [string, string];
    start?: string;
    end?: string;
    counts?: TemplateCounts;
    countsAsOf?: string;
  };
}

/** Calls one of our JSON API routes and maps its error to a message key. */
export async function callApi(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; message?: string; status?: number }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true, data: await res.json().catch(() => null) };
    // The data rule's own words (English), for callers that map known ones to a message.
    const message = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    return { ok: false, error: res.status === 409 ? "conflict" : res.status === 400 ? "invalid" : "generic", message, status: res.status };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * A dialog with a small form that posts JSON to an API route. The server
 * decides whether the user may do it; this only collects the input. It opens
 * from its own `trigger`, or from a row menu item that holds it (`control`).
 */
export function FormDialog(props: {
  trigger?: ReactNode;
  control?: DialogControl;
  title: string;
  description?: string;
  endpoint: string;
  method?: string;
  fields: Field[];
  submitLabel: string;
  /** Where to go afterwards; ":id" is replaced by the new record's id. Default: refresh. */
  redirectTo?: string;
  /** Sent with the fields, such as a position. */
  extra?: Record<string, unknown>;
  /** Send an emptied field as null (to clear it) instead of leaving it out. */
  sendEmptyAsNull?: boolean;
  /** A plain sentence for a refusal the server names (its own words, in English), or null for the usual message. */
  explain?: (message: string | undefined) => string | null;
  /** Open when the page loads (a page opened to fill it in, such as "Use as draft"). Nothing is sent until submitted. */
  defaultOpen?: boolean;
  /** A line above the fields, such as where a pre-filled value came from. */
  notice?: string;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const { open, setOpen, contentProps } = useDialogControl(props.control, props.defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tpl, setTpl] = useState<string>("none");
  const tT = useTranslations("reportTemplates");
  const [confirm, confirmDialog] = useConfirm();

  async function chooseTemplate(f: Field, id: string) {
    const form = formRef.current;
    const area = form?.elements.namedItem(f.name) as HTMLTextAreaElement | null;
    const cfg = f.template;
    if (!form || !area || !cfg || id === "none") return setTpl("none");
    const value = (name: string | undefined) => (name ? String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "") : "");
    const start = cfg.periodFields ? value(cfg.periodFields[0]) : cfg.start;
    const end = cfg.periodFields ? value(cfg.periodFields[1]) : cfg.end;
    const counts = cfg.counts && (!cfg.countsAsOf || end === cfg.countsAsOf) ? cfg.counts : null;
    const outline = reportTemplate(id as ReportTemplateId, cfg.lang, { start, end, counts });
    const replace = templateFill(area.value) === "fill" ? true : await confirm(tT("replace"));
    area.value = noteAfterChoosing(area.value, outline, replace).slice(0, f.maxLength ?? 2000);
    setTpl(replace ? id : "none");
    if (replace) area.focus();
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...props.extra };
    let endpoint = props.endpoint;
    for (const f of props.fields) {
      const v = String(form.get(f.name) ?? "").trim();
      // A field named in the endpoint (":userId") goes in the path, not the body.
      if (endpoint.includes(`:${f.name}`)) endpoint = endpoint.replace(`:${f.name}`, encodeURIComponent(v));
      else if (v) body[f.name] = v;
      else if (props.sendEmptyAsNull && !f.required) body[f.name] = null;
    }
    setBusy(true);
    setError(null);
    setSaid(null);
    const r = await callApi(endpoint, props.method ?? "POST", body);
    setBusy(false);
    // An id in the address the server refused (http.ts): not something the person typed.
    if (!r.ok) return (setSaid(props.explain?.(r.message) ?? (r.message === "invalid id" ? t("errors.badId") : null)), setError(r.error));
    setOpen(false);
    toast.success(t("saved"));
    const newId = (r.data as { id?: string } | null)?.id;
    if (props.redirectTo && newId) router.push(props.redirectTo.replace(":id", encodeURIComponent(newId)));
    else router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[85vh] overflow-y-auto" {...contentProps}>
        <form ref={formRef} onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
          </DialogHeader>
          {props.notice ? <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{props.notice}</p> : null}
          {props.fields.map((f) => (
            <div key={f.name} className="grid gap-2">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.type === "textarea" && f.template ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`f-${f.name}-template`} className="text-xs font-normal text-muted-foreground">
                    {tT("label")}
                  </Label>
                  <Select value={tpl} onValueChange={(v) => void chooseTemplate(f, v)}>
                    <SelectTrigger id={`f-${f.name}-template`} size="sm" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tT("none")}</SelectItem>
                      {REPORT_TEMPLATES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {tT(id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {f.type === "textarea" ? (
                <Textarea
                  id={`f-${f.name}`}
                  name={f.name}
                  required={f.required}
                  maxLength={f.maxLength ?? 2000}
                  rows={3}
                  dir={f.dir}
                  defaultValue={f.defaultValue}
                  placeholder={f.placeholder}
                />
              ) : f.type === "select" ? (
                <Select name={f.name} required={f.required} defaultValue={f.defaultValue ?? f.options?.[0]?.value}>
                  <SelectTrigger id={`f-${f.name}`} className="w-full">
                    <SelectValue placeholder={f.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "person" ? (
                <PersonPicker
                  id={`f-${f.name}`}
                  name={f.name}
                  required={f.required}
                  options={f.options ?? []}
                  defaultValue={f.defaultValue}
                  placeholder={f.placeholder}
                  clearable={f.clearable}
                />
              ) : f.type === "date" ? (
                <DatePicker
                  id={`f-${f.name}`}
                  name={f.name}
                  required={f.required}
                  defaultValue={f.defaultValue}
                  placeholder={f.placeholder ?? f.label}
                  clearLabel={t("clear")}
                />
              ) : (
                <Input
                  id={`f-${f.name}`}
                  name={f.name}
                  required={f.required}
                  maxLength={f.maxLength ?? 200}
                  dir={f.dir}
                  defaultValue={f.defaultValue}
                  placeholder={f.placeholder}
                />
              )}
              {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
            </div>
          ))}
          {/* The error slides the footer down instead of making it jump (Animate UI Auto Height).
              -mt-4 cancels the grid gap while there is nothing to show. */}
          <AutoHeight deps={[error]} className="-mt-4">
            {error ? (
              <p role="alert" className="pt-4 text-sm text-destructive">
                {said ?? t(`errors.${error}`)}
              </p>
            ) : null}
          </AutoHeight>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? t("saving") : props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}

/** A button that calls one API route and refreshes the page. */
export function ApiButton(props: {
  endpoint: string;
  method?: string;
  body?: unknown;
  label: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm";
  confirm?: string;
  icon?: ReactNode;
  /** Tooltip text: one short sentence on what happens (a Hint, opened by hover or keyboard focus). */
  title?: string;
  /** Where to go once it worked (after a delete, the page is gone). */
  redirectTo?: string;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  async function run() {
    if (props.confirm && !(await confirm(props.confirm))) return;
    setBusy(true);
    setError(null);
    const r = await callApi(props.endpoint, props.method ?? "POST", props.body);
    setBusy(false);
    if (r.ok) {
      if (props.redirectTo) router.push(props.redirectTo);
      else router.refresh();
    } else setError(r.error);
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {props.title ? (
        <Hint asChild tip={props.title}>
          <Button variant={props.variant ?? "outline"} size={props.size ?? "sm"} onClick={run} disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : props.icon}
            {props.label}
          </Button>
        </Hint>
      ) : (
        <Button variant={props.variant ?? "outline"} size={props.size ?? "sm"} onClick={run} disabled={busy}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : props.icon}
          {props.label}
        </Button>
      )}
      {error ? <span className="text-xs text-destructive">{t(`errors.${error}`)}</span> : null}
      {confirmDialog}
    </span>
  );
}
