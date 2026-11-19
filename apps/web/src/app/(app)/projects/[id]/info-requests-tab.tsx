"use client";

import { ClipboardList, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { AudienceField, useAudienceRefusal, type AudienceValue } from "@/components/audience-field";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Plus } from "@/components/animate-ui/icons/plus";
import { X } from "@/components/animate-ui/icons/x";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ApiButton, callApi, FormDialog, type Field } from "@/components/form-dialog";
import { RequestRow } from "@/components/request-row";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { SendFileButton, SendFileDialog, uploadErrorKey } from "@/components/send-file-dialog";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DialogControl } from "@/hooks/use-dialog-control";
import { INFO_REQUEST_AREAS, INFO_REQUEST_TEMPLATES, NO_OWNER, requestTitle } from "@/lib/info-requests";
import { requestRowPlan } from "@/lib/row-actions";
import { infoRequestPlacement, labelKey, placementTone, type Reader } from "@/lib/status-words";
import { UPLOAD_LINK_DAY_CHOICES, UPLOAD_LINK_DAYS } from "@/lib/upload-links";
import type { InfoRequestList } from "@/services/info-requests";

type Item = InfoRequestList["items"][number];


/**
 * The project's information request list (wave 1, item 9): what the firm
 * needs from the client, grouped by area. The client answers an item with a
 * file (or says it does not apply); the firm reviews it or returns it with a
 * reason. The server decides every step again.
 */
export function InfoRequestsTab({ projectId, list, reader }: { projectId: string; list: InfoRequestList; reader: Reader }) {
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
                  <ItemRow key={i.id} item={i} ar={ar} files={list.files} ownerOptions={ownerOptions} projectId={projectId} reader={reader} />
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
  projectId,
  reader,
}: {
  item: Item;
  ar: boolean;
  files: InfoRequestList["files"];
  ownerOptions: { value: string; label: string }[];
  projectId: string;
  reader: Reader;
}) {
  const t = useTranslations("infoRequests");
  const tw = useTranslations("statusWords");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  // Giving the item to someone left out of a file sent for it is refused, said plainly (feature A).
  const refusal = useAudienceRefusal();
  const call = useRowCall();
  const title = requestTitle(i, ar);
  const base = `/api/info-requests/${i.id}`;
  // One main button (accept the file, or send one); the rest in the row's menu (page audit U15).
  const plan = requestRowPlan(i.can);
  const inMenu = new Set<string>(plan.menu);
  const note = (status: "requested" | "not_applicable", label: string, hint: string, control: DialogControl) => (
    <FormDialog
      control={control}
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
    <>
      <RequestRow
        title={title}
        description={i.description}
        state={{ label: tw(labelKey(infoRequestPlacement(i.status), reader)), tone: placementTone(infoRequestPlacement(i.status)) }}
        badges={
          <>
            {i.sensitivity === "confidential" ? (
              <ToneBadge tone="open" className="gap-1">
                <Lock className="size-3" />
                {t("confidential")}
              </ToneBadge>
            ) : null}
            {i.overdue ? <ToneBadge tone="problem">{t("overdue")}</ToneBadge> : null}
          </>
        }
        facts={[
          i.ownerName ? t.rich("ownedBy", { name: i.ownerName, who: (c) => <bdi>{c}</bdi> }) : t("noOwner"),
          i.dueDate ? (
            <span className={i.overdue ? "font-medium text-destructive" : undefined}>
              {t(i.overdue ? "overdueOn" : "dueOn", { date: format.dateTime(new Date(i.dueDate), { dateStyle: "medium" }) })}
            </span>
          ) : null,
        ]}
        note={
          i.statusNote && (i.status === "requested" || i.status === "not_applicable") ? (
            <>
              <span className="font-medium">{t(i.status === "requested" ? "returnedNote" : "naNote")}</span> <bdi>{i.statusNote}</bdi>
            </>
          ) : null
        }
        files={i.files.map((f) => ({
          key: f.documentId,
          node: (
            <>
              <a href={`/api/documents/${f.documentId}/download`} className="hover:underline">
                <bdi>{f.title}</bdi>
              </a>
              {f.viaLink ? (
                <span className="text-muted-foreground">
                  {f.viaEmail ? t.rich("link.fromEmail", { email: f.viaEmail, a: (c) => <bdi dir="ltr">{c}</bdi> }) : t("link.byLink")}
                </span>
              ) : null}
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
            </>
          ),
        }))}
        extra={
          i.links.length ? (
            <ul className="space-y-1">
              {i.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Link2 className="size-3.5" />
                  <span>
                    {t.rich("link.active", {
                      email: l.email,
                      date: format.dateTime(new Date(l.expiresAt), { dateStyle: "medium" }),
                      n: l.uploads,
                      a: (c) => <bdi dir="ltr">{c}</bdi>,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null
        }
        main={
          plan.main === "review" ? (
            <ApiButton endpoint={`${base}/status`} body={{ status: "reviewed" }} label={t("accept")} icon={<CircleCheck />} variant="outline" size="sm" />
          ) : plan.main === "answer" ? (
            <AnswerDialog item={i} title={title} files={files} projectId={projectId} />
          ) : null
        }
        menu={
          <RowMenu
            label={tc("moreFor", { name: title })}
            items={[
              {
                key: "answer",
                label: t(i.files.length ? "addFile" : "answer"),
                allowed: inMenu.has("answer"),
                dialog: (control) => <AnswerDialog item={i} title={title} files={files} projectId={projectId} control={control} />,
              },
              {
                key: "sendLink",
                label: t("link.send"),
                allowed: inMenu.has("sendLink"),
                dialog: (control) => (
                  <FormDialog
                    control={control}
                    title={t("link.send")}
                    description={t("link.hint")}
                    endpoint={`${base}/links`}
                    fields={[
                      { name: "email", label: t("link.email"), required: true, maxLength: 254, dir: "ltr", placeholder: "name@company.sa" },
                      {
                        name: "days",
                        label: t("link.days"),
                        type: "select",
                        defaultValue: String(UPLOAD_LINK_DAYS.default),
                        options: UPLOAD_LINK_DAY_CHOICES.map((d) => ({ value: String(d), label: t("link.daysOption", { n: d }) })),
                      },
                    ]}
                    submitLabel={t("link.sendSubmit")}
                  />
                ),
              },
              ...i.links.map((l) => ({
                key: `revoke-${l.id}`,
                label: t("link.revokeFor", { email: l.email }),
                allowed: inMenu.has("revokeLink"),
                confirm: t("link.revokeConfirm", { email: l.email }),
                onSelect: () => void call({ endpoint: `/api/info-request-links/${l.id}`, method: "DELETE" }),
              })),
              { key: "returnIt", label: t("return"), allowed: inMenu.has("returnIt"), dialog: (control) => note("requested", t("return"), t("returnHint"), control) },
              { key: "reopen", label: t("reopen"), allowed: inMenu.has("reopen"), dialog: (control) => note("requested", t("reopen"), t("reopenHint"), control) },
              {
                key: "notApplicable",
                label: t("notApplicable"),
                allowed: inMenu.has("notApplicable"),
                dialog: (control) => note("not_applicable", t("notApplicable"), t("naHint"), control),
              },
              {
                key: "edit",
                label: t("edit"),
                allowed: inMenu.has("edit"),
                dialog: (control) => (
                  <FormDialog
                    control={control}
                    title={t("edit")}
                    endpoint={base}
                    method="PATCH"
                    sendEmptyAsNull
                    explain={refusal}
                    fields={itemFields(t, ownerOptions, { ...i, title })}
                    submitLabel={tc("save")}
                  />
                ),
              },
              {
                key: "remove",
                label: t("remove"),
                allowed: inMenu.has("remove"),
                destructive: true,
                confirm: t("removeConfirm", { title }),
                onSelect: () => void call({ endpoint: base, method: "DELETE" }),
              },
            ]}
          />
        }
      />
      {confirmDialog}
    </>
  );
}

/** Answer an item: the one file dialog (components/send-file-dialog.tsx), a new file or one already shared on the project. */
function AnswerDialog({
  item,
  title,
  files,
  projectId,
  control,
}: {
  item: Item;
  title: string;
  files: InfoRequestList["files"];
  projectId: string;
  /** Opened from the row's menu (another file, when the firm's main step is accepting) rather than its own button. */
  control?: DialogControl;
}) {
  const t = useTranslations("infoRequests");
  const ts = useTranslations("sendFile");
  const tc = useTranslations("common");
  const router = useRouter();
  const [own, setOwn] = useState(false);
  const open = control?.open ?? own;
  const setOpen = (o: boolean) => (control?.onOpenChange ? control.onOpenChange(o) : setOwn(o));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState("");
  // Who sees the new file (feature A): for the people who get the picker; null while it cannot be saved.
  const [audience, setAudience] = useState<{ value: AudienceValue | null; dirty: boolean }>({ value: null, dirty: false });
  const refusal = useAudienceRefusal();
  const choices = files.filter((f) => !item.files.some((x) => x.documentId === f.id));

  function finish() {
    toast.success(t("answered"));
    setOpen(false);
    router.refresh();
  }

  async function upload(form: FormData) {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    if (audience.dirty && !audience.value) return;
    if (audience.dirty && audience.value && audience.value.mode !== "everyone") form.set("audience", JSON.stringify(audience.value));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/info-requests/${item.id}/files`, { method: "POST", body: form });
      if (res.ok) return finish();
      const m = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
      setError(refusal(m) ?? ts(`errors.${uploadErrorKey(res.status, m)}`));
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
    setError(refusal(r.message) ?? (r.message?.includes("assistant") ? t("assistantFile") : tc(`errors.${r.error}`)));
  }

  return (
    <SendFileDialog
      title={ts("title")}
      description={ts("forItem", { item: title })}
      control={{ open, onOpenChange: setOpen, returnFocus: control?.returnFocus }}
      onOpenChange={(o) => (setError(null), setExisting(""), o ? null : setAudience({ value: null, dirty: false }))}
      // The row's one button, so outline: a card keeps a single solid button.
      trigger={control ? undefined : <SendFileButton label={t(item.files.length ? "addFile" : "answer")} />}
      notice={
        item.sensitivity === "confidential" ? (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {t("confidentialHint")}
          </p>
        ) : null
      }
      busy={busy}
      error={error}
      submitLabel={ts("button")}
      submitDisabled={audience.dirty && !audience.value}
      onSubmit={(form) => void upload(form)}
      pick={
        choices.length ? (
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
        ) : undefined
      }
      after={
        <>
          <p className="text-xs text-muted-foreground">{t("sharedHint")}</p>
          {open ? (
            <AudienceField
              kind="document"
              url={`/api/projects/${projectId}/audience?kind=document&visibility=shared&request=${item.id}`}
              onChange={(value, dirty) => setAudience({ value, dirty })}
              disabled={busy}
            />
          ) : null}
        </>
      }
    />
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
