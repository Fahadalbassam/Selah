"use client";

import { Plus } from "@/components/animate-ui/icons/plus";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// The firm's plan for a project, written from the project page: a
// recommendation (optionally answering a finding), and the actions that carry
// it out. The server checks every rule; these dialogs only collect the input
// and turn its refusals into messages (messages/*.json "plan.errors").

import { localLabel } from "@/lib/names";
const NONE = "none";

/** A refusal from the plan routes as a "plan.errors" key, or null for the common messages. */
function planError(message: string | undefined): string | null {
  const m = message ?? "";
  if (m.includes("board decision needs")) return "boardDate";
  if (m.includes("owner must be on the project team")) return "ownerTeam";
  if (m.includes("released action needs")) return "releaseNeeds";
  if (m.includes("minimal records")) return "jobTitle";
  if (m.includes("needs the lead")) return "needsLead";
  if (m.includes("department")) return "department";
  if (m.includes("accountable person")) return "accountable";
  if (m.includes("finding is not in this project")) return "finding";
  if (m.includes("finding was withdrawn")) return "findingWithdrawn";
  if (m.includes("withdrawn")) return "withdrawn";
  return null;
}

function useSubmit(onSaved: (data: unknown) => void) {
  const t = useTranslations("plan.errors");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError(null);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) {
      const key = planError(r.message);
      return setError(key ? t(key) : tc(`errors.${r.error}`));
    }
    onSaved(r.data);
  }
  return { busy, error, setError, send };
}

function Footer({ busy, error, label, onCancel }: { busy: boolean; error: string | null; label: string; onCancel: () => void }) {
  const tc = useTranslations("common");
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : null}
          {busy ? tc("saving") : label}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface RecommendationValues {
  title: string;
  findingId: string | null;
  rationale: string | null;
  targetOutcome: string | null;
  priority: "low" | "medium" | "high" | "critical";
  dueDate: string | null;
  requiredEvidence: string | null;
  departmentId: string | null;
  accountableUserId: string | null;
}

/**
 * Add a recommendation to a project, optionally answering one of its
 * findings; or, with `edit`, correct one (N1). Its source and label are not
 * edits: releasing a firm-only recommendation is its own step.
 */
export function RecommendationDialog(props: {
  projectId: string;
  /** Internal projects have no client, so there is nothing to keep from one. */
  client: boolean;
  findings: { id: string; title: string }[];
  defaultFindingId?: string;
  /** The client's departments and who can be accountable (F31); empty lists hide the fields. */
  scope: {
    departments: { id: string; nameAr: string; nameEn: string | null }[];
    accountables: { userId: string; name: string }[];
  };
  trigger?: ReactNode;
  edit?: { id: string; values: RecommendationValues };
  /** Opened from a menu instead of a trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("plan.rec");
  const ar = useLocale() === "ar";
  const tPrio = useTranslations("priority");
  const tVis = useTranslations("visibility");
  const tc = useTranslations("common");
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (o: boolean) => (props.onOpenChange ? props.onOpenChange(o) : setOwnOpen(o));
  const editing = props.edit?.values;
  const [source, setSource] = useState("consultant");
  const [decidedOn, setDecidedOn] = useState<string | undefined>();
  const { busy, error, setError, send } = useSubmit(() => {
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const finding = text("findingId");
    const pick = (k: string) => (text(k) === NONE ? undefined : text(k));
    const listed = (ids: string[], current: string | null) => current === null || ids.includes(current);
    if (props.edit) {
      // Every field is sent: an emptied one is cleared.
      const or = (k: string) => text(k) ?? null;
      return send(
        `/api/recommendations/${props.edit.id}`,
        {
          title: text("title"),
          ...(props.findings.length ? { findingId: finding === NONE ? null : (finding ?? null) } : {}),
          rationale: or("rationale"),
          targetOutcome: or("targetOutcome"),
          priority: text("priority") ?? "medium",
          dueDate: or("dueDate"),
          requiredEvidence: or("requiredEvidence"),
          // Only the fields the dialog shows; NONE clears them.
          // A department switched off since, or a person no longer on the project, isn't in the
          // lists; leaving the field alone then keeps it rather than clearing it.
          ...(props.scope.departments.length && listed(props.scope.departments.map((d) => d.id), editing!.departmentId)
            ? { departmentId: pick("departmentId") ?? null }
            : {}),
          ...(props.scope.accountables.length && listed(props.scope.accountables.map((p) => p.userId), editing!.accountableUserId)
            ? { accountableUserId: pick("accountableUserId") ?? null }
            : {}),
        },
        "PATCH",
      );
    }
    await send(`/api/projects/${props.projectId}/recommendations`, {
      title: text("title"),
      findingId: finding === NONE ? undefined : finding,
      rationale: text("rationale"),
      targetOutcome: text("targetOutcome"),
      priority: text("priority") ?? "medium",
      dueDate: text("dueDate"),
      requiredEvidence: text("requiredEvidence"),
      source,
      decidedOn: source === "board_decision" ? decidedOn : undefined,
      visibility: props.client ? (text("visibility") ?? "shared") : "shared",
      departmentId: pick("departmentId"),
      accountableUserId: pick("accountableUserId"),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit") : t("add")}</DialogTitle>
            <DialogDescription>{editing ? t("editHint") : t("addHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="r-title">{t("title")}</Label>
            <Input id="r-title" name="title" required maxLength={300} dir="auto" defaultValue={editing?.title} />
          </div>
          {props.findings.length ? (
            <div className="grid gap-2">
              <Label htmlFor="r-finding">{t("finding")}</Label>
              <Select name="findingId" defaultValue={editing ? (editing.findingId ?? NONE) : (props.defaultFindingId ?? NONE)}>
                <SelectTrigger id="r-finding" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noFinding")}</SelectItem>
                  {props.findings.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {editing ? null : (
              <div className="grid gap-2">
                <Label htmlFor="r-source">{t("source")}</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="r-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["consultant", "board_decision", "compliance"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`sources.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="r-priority">{t("priority")}</Label>
              <Select name="priority" defaultValue={editing?.priority ?? "medium"}>
                <SelectTrigger id="r-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "critical"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {tPrio(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!editing && source === "board_decision" ? (
            <div className="grid gap-2">
              <Label htmlFor="r-decided">{t("decidedOn")}</Label>
              <DatePicker
                id="r-decided"
                value={decidedOn}
                onChange={setDecidedOn}
                placeholder={t("decidedOn")}
                required
                disabled={{ after: new Date() }}
              />
            </div>
          ) : null}
          {props.scope.departments.length || props.scope.accountables.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {props.scope.departments.length ? (
                <div className="grid gap-2">
                  <Label htmlFor="r-dept">{t("department")}</Label>
                  <Select name="departmentId" defaultValue={editing?.departmentId ?? NONE}>
                    <SelectTrigger id="r-dept" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("allDepartments")}</SelectItem>
                      {props.scope.departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {localLabel(d, ar)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("departmentHint")}</p>
                </div>
              ) : null}
              {props.scope.accountables.length ? (
                <div className="grid gap-2">
                  <Label htmlFor="r-accountable">{t("accountable")}</Label>
                  <Select name="accountableUserId" defaultValue={editing?.accountableUserId ?? NONE}>
                    <SelectTrigger id="r-accountable" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("noAccountable")}</SelectItem>
                      {props.scope.accountables.map((p) => (
                        <SelectItem key={p.userId} value={p.userId}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("accountableHint")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="r-rationale">{t("rationale")}</Label>
            <Textarea id="r-rationale" name="rationale" rows={3} maxLength={8000} dir="auto" defaultValue={editing?.rationale ?? undefined} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="r-outcome">{t("targetOutcome")}</Label>
            <Textarea id="r-outcome" name="targetOutcome" rows={2} maxLength={4000} dir="auto" defaultValue={editing?.targetOutcome ?? undefined} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="r-evidence">{t("requiredEvidence")}</Label>
            <Textarea id="r-evidence" name="requiredEvidence" rows={2} maxLength={4000} dir="auto" defaultValue={editing?.requiredEvidence ?? undefined} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="r-due">{t("dueDate")}</Label>
              <DatePicker id="r-due" name="dueDate" placeholder={t("dueDate")} clearLabel={tc("clear")} defaultValue={editing?.dueDate ?? undefined} />
            </div>
            {props.client && !editing ? (
              <div className="grid gap-2">
                <Label htmlFor="r-visibility">{t("visibility")}</Label>
                <Select name="visibility" defaultValue="shared">
                  <SelectTrigger id="r-visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">{tVis("shared")}</SelectItem>
                    <SelectItem value="firm_private">{tVis("firm_private")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <Footer busy={busy} error={error} label={editing ? tc("save") : t("save")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ActionOptions {
  owners: { userId: string; name: string }[];
  /** A client the firm manages: the owner is typed, not picked. */
  ownerByName: boolean;
  /** ...and with minimal records, typed as a job title. */
  minimalRecords: boolean;
  departments: { id: string; nameAr: string; nameEn: string | null }[];
  canRelease: boolean;
}

/** Add an action under a recommendation: its owner, due date and evidence list, as a draft or released. */
export function ActionDialog(props: {
  recommendationId: string;
  recommendationTitle: string;
  options: ActionOptions;
  /** A department's recommendation: its actions are that department's (the database sets it). */
  recommendationDepartmentId?: string | null;
  trigger: ReactNode;
}) {
  const t = useTranslations("plan.action");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const { owners, ownerByName, minimalRecords, departments, canRelease } = props.options;
  const hasOwner = ownerByName || owners.length > 0;
  const [open, setOpen] = useState(false);
  const [release, setRelease] = useState(canRelease && hasOwner);
  const [due, setDue] = useState<string | undefined>();
  const [items, setItems] = useState<string[]>([]);
  const { busy, error, setError, send } = useSubmit(() => {
    setOpen(false);
    toast.success(release ? t("released") : t("drafted"));
    router.refresh();
  });

  function reset(o: boolean) {
    setOpen(o);
    setError(null);
    if (o) {
      setRelease(canRelease && hasOwner);
      setDue(undefined);
      setItems([]);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const owner = text("ownerUserId");
    const dept = text("departmentId");
    await send(`/api/recommendations/${props.recommendationId}/actions`, {
      title: text("title"),
      description: text("description"),
      ownerUserId: owner && owner !== NONE ? owner : undefined,
      ownerName: ownerByName ? text("ownerName") : undefined,
      departmentId: !props.recommendationDepartmentId && dept && dept !== NONE ? dept : undefined,
      dueDate: due,
      evidence: items.map((title) => title.trim()).filter(Boolean).map((title) => ({ title })),
      release,
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>
              <span className="block font-medium text-foreground" dir="auto">
                {props.recommendationTitle}
              </span>
              {t("addHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="a-title">{t("title")}</Label>
            <Input id="a-title" name="title" required maxLength={300} dir="auto" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-description">{t("description")}</Label>
            <Textarea id="a-description" name="description" rows={3} maxLength={8000} dir="auto" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {ownerByName ? (
              <div className="grid gap-2">
                <Label htmlFor="a-owner-name">{minimalRecords ? t("ownerTitle") : t("ownerName")}</Label>
                <Input id="a-owner-name" name="ownerName" maxLength={200} required={release} dir="auto" />
                <p className="text-xs text-muted-foreground">{t("ownerNameHint")}</p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="a-owner">{t("owner")}</Label>
                <Select name="ownerUserId" defaultValue={owners.length === 1 ? owners[0]!.userId : NONE} required={release}>
                  <SelectTrigger id="a-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("noOwner")}</SelectItem>
                    {owners.map((o) => (
                      <SelectItem key={o.userId} value={o.userId}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {owners.length === 0 ? <p className="text-xs text-muted-foreground">{t("noOwners")}</p> : null}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="a-due">{release ? t("dueDate") : t("dueOptional")}</Label>
              <DatePicker
                id="a-due"
                value={due}
                onChange={setDue}
                placeholder={t("dueDate")}
                required={release}
                clearLabel={tc("clear")}
                disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
              />
            </div>
          </div>
          {departments.length ? (
            <div className="grid gap-2">
              <Label htmlFor="a-dept">{t("department")}</Label>
              <Select name="departmentId" defaultValue={props.recommendationDepartmentId ?? NONE} disabled={!!props.recommendationDepartmentId}>
                <SelectTrigger id="a-dept" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noDepartment")}</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {localLabel(d, ar)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {props.recommendationDepartmentId ? <p className="text-xs text-muted-foreground">{t("departmentFollows")}</p> : null}
            </div>
          ) : null}
          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("evidence")}</legend>
            <p className="text-xs text-muted-foreground">{t("evidenceHint")}</p>
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={t("item", { n: i + 1 })}
                  value={item}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={300}
                  dir="auto"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("removeItem", { n: i + 1 })}
                  title={t("removeItem", { n: i + 1 })}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </div>
            ))}
            {items.length < 50 ? (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setItems([...items, ""])}>
                <Plus />
                {t("addItem")}
              </Button>
            ) : null}
          </fieldset>
          {canRelease ? (
            <div className="flex items-start gap-3">
              {/* Keeps Radix's hidden form input inside the dialog in RTL (as on the settings page). */}
              <span className="relative [&>input]:!start-0 [&>input]:![transform:none]">
                <Switch id="a-release" checked={release} onCheckedChange={setRelease} disabled={!hasOwner} />
              </span>
              <div className="grid gap-1">
                <Label htmlFor="a-release" className="leading-snug">
                  {t("release")}
                </Label>
                <p className="text-xs text-muted-foreground">{hasOwner ? t("releaseHint") : t("noOwners")}</p>
              </div>
            </div>
          ) : null}
          <Footer busy={busy} error={error} label={t("save")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
