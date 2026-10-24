"use client";

import { ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Paperclip } from "@/components/animate-ui/icons/paperclip";
import { Plus } from "@/components/animate-ui/icons/plus";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { X } from "@/components/animate-ui/icons/x";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ApiButton, callApi, FormDialog, type Field } from "@/components/form-dialog";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge, type Tone } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INFO_REQUEST_AREAS, INFO_REQUEST_TEMPLATES, NO_OWNER, requestTitle } from "@/lib/info-requests";
import { ACCEPTED_EXTENSIONS } from "@/lib/upload-rules";
import type { InfoRequestList } from "@/services/info-requests";

type Item = InfoRequestList["items"][number];

const TONES: Record<Item["status"], Tone> = { requested: "open", received: "active", reviewed: "verified", not_applicable: "neutral" };

/**
 * The project's information request list (wave 1, item 9): what the firm
 * needs from the client, grouped by area. The client answers an item with a
 * file (or says it does not apply); the firm reviews it or returns it with a
 * reason. The server decides every step again.
 */
export function InfoRequestsTab({ projectId, list }: { projectId: string; list: InfoRequestList }) {
  const t = useTranslations("infoRequests");
  const ar = useLocale() === "ar";
  const { items, can, owners } = list;
  const counts = Object.fromEntries(
    (["requested", "received", "reviewed", "not_applicable"] as const).map((s) => [s, items.filter((i) => i.status === s).length]),
  );
  const overdue = items.filter((i) => i.overdue).length;
  const areas = INFO_REQUEST_AREAS.filter((a) => items.some((i) => i.area === a));
  // Only the counts that say something: "4 items · 3 waiting · 1 overdue".
  const summary = [
    t("total", { n: items.length }),
    ...(["requested", "received", "reviewed", "not_applicable"] as const)
      .filter((st) => counts[st])
      .map((st) => `${counts[st]} ${t(`counted.${st}`)}`),
    ...(overdue ? [t("overdueCount", { n: overdue })] : []),
  ].join(" · ");
  const ownerOptions = [{ value: NO_OWNER, label: t("noOwner") }, ...owners.map((o) => ({ value: o.id, label: o.name }))];

  return (
    <div className="space-y-4">
      <SectionHeader title={t("title")} description={items.length ? summary : t(can.manage ? "hintFirm" : "hintClient")}>
        {can.manage ? (
          <div className="flex flex-wrap gap-2">
            <TemplatePicker projectId={projectId} used={list.used} ownerOptions={ownerOptions} />
            <FormDialog
              trigger={
                <Button size="sm">
                  <Plus />
                  {t("add")}
                </Button>
              }
              title={t("add")}
              endpoint={`/api/projects/${projectId}/info-requests`}
              fields={itemFields(t, ownerOptions)}
              submitLabel={t("add")}
            />
          </div>
        ) : null}
      </SectionHeader>

      {items.length === 0 ? (
        <EmptyState icon={<ClipboardList />} description={t(can.manage ? "emptyFirm" : "emptyClient")} />
      ) : (
        areas.map((area) => (
          <section key={area} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{t(`areas.${area}`)}</h3>
            <ul className="divide-y rounded-xl border bg-card">
              {items
                .filter((i) => i.area === area)
                .map((i) => (
                  <ItemRow key={i.id} item={i} ar={ar} files={list.files} ownerOptions={ownerOptions} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function itemFields(
  t: ReturnType<typeof useTranslations<"infoRequests">>,
  ownerOptions: { value: string; label: string }[],
  item?: Item,
): Field[] {
  return [
    {
      name: "area",
      label: t("area"),
      type: "select",
      required: true,
      defaultValue: item?.area ?? "",
      placeholder: t("areaPick"),
      options: INFO_REQUEST_AREAS.map((a) => ({ value: a, label: t(`areas.${a}`) })),
    },
    { name: "title", label: t("itemTitle"), required: true, maxLength: 200, defaultValue: item?.title },
    { name: "description", label: t("description"), type: "textarea", maxLength: 2000, defaultValue: item?.description ?? undefined },
    { name: "ownerUserId", label: t("owner"), type: "select", defaultValue: item?.ownerUserId ?? NO_OWNER, options: ownerOptions },
    { name: "dueDate", label: t("due"), type: "date", defaultValue: item?.dueDate ?? undefined },
    {
      name: "sensitivity",
      label: t("sensitivity"),
      type: "select",
      defaultValue: item?.sensitivity ?? "standard",
      options: [
        { value: "standard", label: t("standard") },
        { value: "confidential", label: t("confidentialOption") },
      ],
    },
  ];
}

function ItemRow({
  item: i,
  ar,
  files,
  ownerOptions,
}: {
  item: Item;
  ar: boolean;
  files: InfoRequestList["files"];
  ownerOptions: { value: string; label: string }[];
}) {
  const t = useTranslations("infoRequests");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const title = requestTitle(i, ar);
  const base = `/api/info-requests/${i.id}`;
  const note = (status: "requested" | "not_applicable", label: string, hint: string) => (
    <FormDialog
      trigger={
        <Button size="sm" variant="ghost">
          {status === "requested" ? <RotateCcw /> : null}
          {label}
        </Button>
      }
      title={label}
      description={hint}
      endpoint={`${base}/status`}
      extra={{ status }}
      fields={[{ name: "note", label: t("reason"), type: "textarea", required: true, maxLength: 1000 }]}
      submitLabel={label}
    />
  );

  async function takeOff(documentId: string, name: string) {
    if (!(await confirm(t("removeFileConfirm", { name })))) return;
    const r = await callApi(`${base}/files/${documentId}`, "DELETE");
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    router.refresh();
  }

  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Text in either language keeps the page's alignment. */}
          <p className="font-medium">
            <bdi>{title}</bdi>
          </p>
          {i.description ? (
            <p className="max-w-3xl whitespace-pre-line text-muted-foreground">
              <bdi>{i.description}</bdi>
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{i.ownerName ? t.rich("ownedBy", { name: i.ownerName, who: (c) => <bdi>{c}</bdi> }) : t("noOwner")}</span>
            {i.dueDate ? (
              <span className={i.overdue ? "font-medium text-destructive" : undefined}>
                {t(i.overdue ? "overdueOn" : "dueOn", { date: format.dateTime(new Date(i.dueDate), { dateStyle: "medium" }) })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {i.sensitivity === "confidential" ? (
            <ToneBadge tone="open" className="gap-1">
              <Lock className="size-3" />
              {t("confidential")}
            </ToneBadge>
          ) : null}
          {i.overdue ? <ToneBadge tone="problem">{t("overdue")}</ToneBadge> : null}
          <ToneBadge tone={TONES[i.status]}>{t(`status.${i.status}`)}</ToneBadge>
        </div>
      </div>

      {i.statusNote && (i.status === "requested" || i.status === "not_applicable") ? (
        <p className="max-w-3xl rounded-md bg-muted px-3 py-2 text-xs">
          <span className="font-medium">{t(i.status === "requested" ? "returnedNote" : "naNote")}</span> <bdi>{i.statusNote}</bdi>
        </p>
      ) : null}

      {i.files.length ? (
        <ul className="flex flex-wrap gap-2">
          {i.files.map((f) => (
            <li key={f.documentId} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              <FileText className="size-3.5 text-muted-foreground" />
              <a href={`/api/documents/${f.documentId}/download`} className="hover:underline">
                <bdi>{f.title}</bdi>
              </a>
              {f.canRemove ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("removeFile", { name: f.title })}
                  title={t("removeFile", { name: f.title })}
                  onClick={() => takeOff(f.documentId, f.title)}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {i.can.answer ? <AnswerDialog item={i} title={title} files={files} firm={i.can.edit} /> : null}
        {i.can.review ? (
          <ApiButton endpoint={`${base}/status`} body={{ status: "reviewed" }} label={t("review")} icon={<CircleCheck />} />
        ) : null}
        {i.can.returnIt ? note("requested", t("return"), t("returnHint")) : null}
        {i.can.reopen ? note("requested", t("reopen"), t("reopenHint")) : null}
        {i.can.notApplicable ? note("not_applicable", t("notApplicable"), t("naHint")) : null}
        {i.can.edit ? (
          <FormDialog
            trigger={
              <Button size="sm" variant="ghost">
                {t("edit")}
              </Button>
            }
            title={t("edit")}
            endpoint={base}
            method="PATCH"
            sendEmptyAsNull
            fields={itemFields(t, ownerOptions, { ...i, title })}
            submitLabel={tc("save")}
          />
        ) : null}
        {i.can.remove ? (
          <ApiButton endpoint={base} method="DELETE" variant="ghost" label={t("remove")} confirm={t("removeConfirm", { title })} />
        ) : null}
      </div>
      {confirmDialog}
    </li>
  );
}

/** Answer an item: upload a file, or pick one already shared on the project. */
function AnswerDialog({ item, title, files, firm }: { item: Item; title: string; files: InfoRequestList["files"]; firm: boolean }) {
  const t = useTranslations("infoRequests");
  const tf = useTranslations("fileActions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState("");
  const choices = files.filter((f) => !item.files.some((x) => x.documentId === f.id));

  function finish() {
    toast.success(t("answered"));
    setOpen(false);
    router.refresh();
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/info-requests/${item.id}/files`, { method: "POST", body: form });
      if (res.ok) return finish();
      const m = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
      setError(
        res.status === 503
          ? tf("errors.scanner")
          : m.includes("infected")
            ? tf("errors.infected")
            : m.includes("too large")
              ? tf("errors.tooLarge")
              : m.includes("rejected")
                ? tf("errors.type")
                : tc("errors.generic"),
      );
    } catch {
      setError(tc("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function useExisting() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/info-requests/${item.id}/files/existing`, "POST", { documentId: existing });
    setBusy(false);
    if (r.ok) return finish();
    setError(r.message?.includes("assistant") ? t("assistantFile") : tc(`errors.${r.error}`));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null), setExisting(""))}>
      <DialogTrigger asChild>
        {/* The client's main step; the firm only files what reached it another way. */}
        <Button size="sm" variant={firm ? "outline" : "default"}>
          <Paperclip />
          {t(item.files.length ? "addFile" : "answer")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={upload} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("answerTitle")}</DialogTitle>
            <DialogDescription dir="auto">{title}</DialogDescription>
          </DialogHeader>
          {item.sensitivity === "confidential" ? (
            <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              {t("confidentialHint")}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={`answer-${item.id}`}>{t("uploadNew")}</Label>
            <Input id={`answer-${item.id}`} name="file" type="file" accept={ACCEPTED_EXTENSIONS} required />
            <p className="text-xs text-muted-foreground">{t("sharedHint")}</p>
          </div>
          {choices.length ? (
            <div className="grid gap-2">
              <Label htmlFor={`existing-${item.id}`}>{t("orExisting")}</Label>
              <div className="flex gap-2">
                <Select value={existing} onValueChange={setExisting}>
                  <SelectTrigger id={`existing-${item.id}`} className="min-w-0 flex-1">
                    <SelectValue placeholder={t("pickFile")} />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" disabled={!existing || busy} onClick={useExisting}>
                  {t("useFile")}
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {tf("upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add items from the starting list by area, with one owner and due date for all of them. */
function TemplatePicker({
  projectId,
  used,
  ownerOptions,
}: {
  projectId: string;
  used: string[];
  ownerOptions: { value: string; label: string }[];
}) {
  const t = useTranslations("infoRequests");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const areas = INFO_REQUEST_AREAS.filter((a) => INFO_REQUEST_TEMPLATES.some((x) => x.area === a));

  function toggle(key: string, on: boolean) {
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked.size) return setError("pick");
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/projects/${projectId}/info-requests/templates`, "POST", {
      keys: [...picked],
      ownerUserId: String(form.get("ownerUserId") ?? NO_OWNER),
      dueDate: String(form.get("dueDate") ?? ""),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(t("addedCount", { n: (r.data as { added: number }).added }));
    setOpen(false);
    setPicked(new Set());
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ClipboardList />
          {t("fromList")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("fromList")}</DialogTitle>
            <DialogDescription>{t("fromListHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {areas.map((a) => (
              <fieldset key={a} className="grid content-start gap-2">
                <legend className="mb-1 text-sm font-medium">{t(`areas.${a}`)}</legend>
                {INFO_REQUEST_TEMPLATES.filter((x) => x.area === a).map((x) => {
                  const done = used.includes(x.key);
                  return (
                    <label key={x.key} className="flex items-start gap-2 text-sm has-[[data-disabled]]:text-muted-foreground">
                      <Checkbox
                        className="mt-0.5"
                        checked={done || picked.has(x.key)}
                        disabled={done}
                        onCheckedChange={(v) => toggle(x.key, v === true)}
                      />
                      <span>
                        {ar ? x.ar : x.en}
                        {x.confidential ? (
                          <Lock className="ms-1 inline size-3 text-muted-foreground" aria-label={t("confidential")} />
                        ) : null}
                        {done ? <span className="ms-2 text-xs">{t("onList")}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tpl-owner">{t("owner")}</Label>
              <Select name="ownerUserId" defaultValue={NO_OWNER}>
                <SelectTrigger id="tpl-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-due">{t("due")}</Label>
              <DatePicker id="tpl-due" name="dueDate" placeholder={t("due")} clearLabel={tc("clear")} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error === "pick" ? t("pickSome") : tc(`errors.${error}`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("addPicked", { n: picked.size })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
