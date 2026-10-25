"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** What the form shows when it edits a recorded engagement. */
export interface EngagementValues {
  title: string;
  signedOn: string;
  contractRef: string | null;
  scope: string;
  exclusions: string | null;
  dataAgreementOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  retainerFollows: boolean;
}

/**
 * The fields of a signed engagement, for any form that records one (the
 * client page, an inquiry being won). Dates post as YYYY-MM-DD.
 */
export function EngagementFields({ values, prefix = "e" }: { values?: Partial<EngagementValues>; prefix?: string }) {
  const t = useTranslations("engagements");
  const tc = useTranslations("common");
  const f = (name: string) => `${prefix}-${name}`;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={f("title")}>{t("fields.title")}</Label>
        <Input id={f("title")} name="title" required minLength={2} maxLength={200} defaultValue={values?.title} placeholder={t("fields.titlePlaceholder")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={f("signedOn")}>{t("fields.signedOn")}</Label>
          <DatePicker id={f("signedOn")} name="signedOn" required defaultValue={values?.signedOn} placeholder={t("fields.signedOn")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={f("contractRef")}>{t("fields.contractRef")}</Label>
          <Input id={f("contractRef")} name="contractRef" maxLength={100} dir="ltr" defaultValue={values?.contractRef ?? undefined} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={f("scope")}>{t("fields.scope")}</Label>
        <Textarea id={f("scope")} name="scope" required minLength={2} maxLength={4000} rows={3} defaultValue={values?.scope} placeholder={t("fields.scopePlaceholder")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={f("exclusions")}>{t("fields.exclusions")}</Label>
        <Textarea id={f("exclusions")} name="exclusions" maxLength={4000} rows={2} defaultValue={values?.exclusions ?? undefined} placeholder={t("fields.exclusionsPlaceholder")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={f("startsOn")}>{t("fields.startsOn")}</Label>
          <DatePicker id={f("startsOn")} name="startsOn" defaultValue={values?.startsOn ?? undefined} placeholder={t("fields.startsOn")} clearLabel={tc("clear")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={f("endsOn")}>{t("fields.endsOn")}</Label>
          <DatePicker id={f("endsOn")} name="endsOn" defaultValue={values?.endsOn ?? undefined} placeholder={t("fields.endsOn")} clearLabel={tc("clear")} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={f("dataAgreementOn")}>{t("fields.dataAgreementOn")}</Label>
        <DatePicker
          id={f("dataAgreementOn")}
          name="dataAgreementOn"
          defaultValue={values?.dataAgreementOn ?? undefined}
          placeholder={t("fields.dataAgreementOn")}
          clearLabel={tc("clear")}
        />
        <p className="text-xs text-muted-foreground">{t("fields.dataAgreementHint")}</p>
      </div>
      <Label htmlFor={f("retainerFollows")} className="flex items-start gap-2 font-normal">
        <Checkbox id={f("retainerFollows")} name="retainerFollows" defaultChecked={values?.retainerFollows} className="mt-0.5" />
        <span>{t("fields.retainerFollows")}</span>
      </Label>
    </div>
  );
}

/** The engagement fields of a submitted form, as the API takes them. */
export function engagementBody(form: FormData, editing = false): Record<string, unknown> {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const optional = (k: string) => text(k) || (editing ? null : undefined);
  return {
    title: text("title"),
    signedOn: text("signedOn"),
    contractRef: optional("contractRef"),
    scope: text("scope"),
    exclusions: optional("exclusions"),
    dataAgreementOn: optional("dataAgreementOn"),
    startsOn: optional("startsOn"),
    endsOn: optional("endsOn"),
    retainerFollows: form.get("retainerFollows") === "on",
  };
}

/**
 * Record what a client signed, or correct it. When recording, the firm
 * admin ticks the draft projects it covers; they become planned and the
 * client sees them.
 */
export function EngagementDialog(props: {
  trigger: ReactNode;
  endpoint: string;
  method?: "POST" | "PATCH";
  values?: EngagementValues;
  drafts?: { id: string; title: string }[];
  redirectTo?: string;
}) {
  const t = useTranslations("engagements");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = props.method === "PATCH";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = engagementBody(form, editing);
    const projectIds = form.getAll("projectIds").map(String);
    if (!editing && projectIds.length) body.projectIds = projectIds;
    if (!body.signedOn) return setError(t("errors.signedOn"));
    setBusy(true);
    setError(null);
    const r = await callApi(props.endpoint, props.method ?? "POST", Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    setBusy(false);
    if (!r.ok) return setError(engagementError(t, tc, r));
    setOpen(false);
    toast.success(tc("saved"));
    const id = (r.data as { id?: string } | null)?.id;
    if (props.redirectTo && id) router.push(props.redirectTo.replace(":id", id));
    else router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit") : t("record")}</DialogTitle>
            <DialogDescription>{editing ? t("editHint") : t("recordHint")}</DialogDescription>
          </DialogHeader>
          <EngagementFields values={props.values} />
          {!editing && props.drafts?.length ? (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t("covers")}</legend>
              <p className="-mt-1 text-xs text-muted-foreground">{t("coversHint")}</p>
              {props.drafts.map((d) => (
                <Label key={d.id} className="flex items-center gap-2 font-normal">
                  <Checkbox name="projectIds" value={d.id} />
                  <span dir="auto">{d.title}</span>
                </Label>
              ))}
            </fieldset>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? tc("saving") : editing ? tc("save") : t("recordButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type T = ReturnType<typeof useTranslations>;

/** The database's words for a refused engagement, as a message the person can act on. */
export function engagementError(t: T, tc: T, r: { error: string; message?: string }): string {
  const m = r.message ?? "";
  if (m.includes("on or after the day")) return t("errors.future");
  if (m.includes("ends after it starts") || m.includes("engagement_period")) return t("errors.period");
  return tc(`errors.${r.error}`);
}

/** Bring more of the client's draft projects under a signed engagement. */
export function CoverDialog({ endpoint, drafts, trigger }: { endpoint: string; drafts: { id: string; title: string }[]; trigger: ReactNode }) {
  const t = useTranslations("engagements");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const projectIds = new FormData(e.currentTarget).getAll("projectIds").map(String);
    if (!projectIds.length) return setError(t("errors.pickOne"));
    setBusy(true);
    setError(null);
    const r = await callApi(endpoint, "POST", { projectIds });
    setBusy(false);
    if (!r.ok) return setError(engagementError(t, tc, r));
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("cover")}</DialogTitle>
            <DialogDescription>{t("coversHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {drafts.map((d) => (
              <Label key={d.id} className="flex items-center gap-2 font-normal">
                <Checkbox name="projectIds" value={d.id} />
                <span dir="auto">{d.title}</span>
              </Label>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("coverButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
