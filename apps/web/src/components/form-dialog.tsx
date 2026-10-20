"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select";
  required?: boolean;
  maxLength?: number;
  dir?: "rtl" | "ltr";
  options?: { value: string; label: string }[];
}

/** Calls one of our JSON API routes and maps its error to a message key. */
export async function callApi(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true, data: await res.json().catch(() => null) };
    return { ok: false, error: res.status === 409 ? "conflict" : res.status === 400 ? "invalid" : "generic" };
  } catch {
    return { ok: false, error: "generic" };
  }
}

/**
 * A dialog with a small form that posts JSON to an API route. The server
 * decides whether the user may do it; this only collects the input.
 */
export function FormDialog(props: {
  trigger: ReactNode;
  title: string;
  description?: string;
  endpoint: string;
  method?: string;
  fields: Field[];
  submitLabel: string;
  /** Where to go afterwards; ":id" is replaced by the new record's id. Default: refresh. */
  redirectTo?: string;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    for (const f of props.fields) {
      const v = String(form.get(f.name) ?? "").trim();
      if (v) body[f.name] = v;
    }
    setBusy(true);
    setError(null);
    const r = await callApi(props.endpoint, props.method ?? "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    const newId = (r.data as { id?: string } | null)?.id;
    if (props.redirectTo && newId) router.push(props.redirectTo.replace(":id", encodeURIComponent(newId)));
    else router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
          </DialogHeader>
          {props.fields.map((f) => (
            <div key={f.name} className="grid gap-2">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea id={`f-${f.name}`} name={f.name} required={f.required} maxLength={f.maxLength ?? 2000} rows={3} dir={f.dir} />
              ) : f.type === "select" ? (
                <select
                  id={`f-${f.name}`}
                  name={f.name}
                  required={f.required}
                  className={cn(
                    "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  )}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input id={`f-${f.name}`} name={f.name} required={f.required} maxLength={f.maxLength ?? 200} dir={f.dir} />
              )}
            </div>
          ))}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("saving") : props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
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
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (props.confirm && !window.confirm(props.confirm)) return;
    setBusy(true);
    setError(null);
    const r = await callApi(props.endpoint, props.method ?? "POST", props.body);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={props.variant ?? "outline"} size={props.size ?? "sm"} onClick={run} disabled={busy}>
        {props.label}
      </Button>
      {error ? <span className="text-xs text-destructive">{t(`errors.${error}`)}</span> : null}
    </span>
  );
}
