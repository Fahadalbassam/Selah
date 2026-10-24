"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Ellipsis } from "@/components/animate-ui/icons/ellipsis";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecommendationDialog, type RecommendationValues } from "./plan-dialogs";

/** From recordControls() on the server; the server and the database decide again. */
export interface RecordCan {
  edit: boolean;
  release: boolean;
  withdraw: boolean;
  delete: boolean;
}

type Props = {
  id: string;
  title: string;
  can: RecordCan;
  /** Open actions a withdrawal would close (recommendations). */
  openActions?: number;
} & (
  | { kind: "finding"; values: { title: string; description: string | null } }
  | {
      kind: "recommendation";
      values: RecommendationValues;
      projectId: string;
      client: boolean;
      findings: { id: string; title: string }[];
    }
);

/**
 * The firm's changes to a finding or recommendation after it was written
 * (journey-map gap N1): correct it, share a firm-only one with the client
 * (one way), withdraw a released one with the reason, or delete one the client
 * never saw. Renders nothing when there is nothing to offer.
 */
export function RecordActions(props: Props) {
  const t = useTranslations("plan.changes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/${props.kind === "finding" ? "findings" : "recommendations"}/${props.id}`;
  const { can } = props;
  if (!can.edit && !can.release && !can.withdraw && !can.delete) return null;

  async function run(message: string, url: string, method: string, done: string) {
    if (!(await confirm(message))) return;
    const r = await callApi(url, method);
    if (!r.ok) return void toast.error(tc(`errors.${r.error}`));
    toast.success(done);
    router.refresh();
  }

  async function send(url: string, method: string, body: unknown, done: string, close: () => void) {
    setBusy(true);
    setError(null);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) {
      const m = r.message ?? "";
      return setError(
        m.includes("answer this finding") ? t("errors.answered") : m.includes("open actions") ? t("errors.openActions") : tc(`errors.${r.error}`),
      );
    }
    close();
    toast.success(done);
    router.refresh();
  }

  function withdraw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    return send(`${base}/withdraw`, "POST", { reason }, t("withdrawn"), () => setWithdrawOpen(false));
  }

  function editFinding(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim() || null;
    return send(base, "PATCH", { title, description }, tc("saved"), () => setEditOpen(false));
  }

  const kind = props.kind;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("menu", { title: props.title })} title={t("menu", { title: props.title })}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.edit ? <DropdownMenuItem onSelect={() => (setError(null), setEditOpen(true))}>{t("edit")}</DropdownMenuItem> : null}
          {can.release ? (
            <DropdownMenuItem onSelect={() => run(t(`${kind}.releaseConfirm`), `${base}/release`, "POST", t("released"))}>{t("release")}</DropdownMenuItem>
          ) : null}
          {can.withdraw || can.delete ? <DropdownMenuSeparator /> : null}
          {can.withdraw ? <DropdownMenuItem onSelect={() => (setError(null), setWithdrawOpen(true))}>{t("withdraw")}</DropdownMenuItem> : null}
          {can.delete ? (
            <DropdownMenuItem variant="destructive" onSelect={() => run(t(`${kind}.deleteConfirm`), base, "DELETE", t("deleted"))}>
              {t("delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDialog}

      {props.kind === "recommendation" && can.edit ? (
        <RecommendationDialog
          projectId={props.projectId}
          client={props.client}
          findings={props.findings}
          // Department and accountable person are set when it is added (F31).
          scope={{ departments: [], accountables: [] }}
          edit={{ id: props.id, values: props.values }}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
      {props.kind === "finding" && can.edit ? (
        <Dialog open={editOpen} onOpenChange={(o) => (setEditOpen(o), setError(null))}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <form onSubmit={editFinding} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{t("finding.edit")}</DialogTitle>
                <DialogDescription>{t("editHint")}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`f-title-${props.id}`}>{t("finding.title")}</Label>
                <Input id={`f-title-${props.id}`} name="title" required maxLength={300} dir="auto" defaultValue={props.values.title} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`f-desc-${props.id}`}>{t("finding.description")}</Label>
                <Textarea id={`f-desc-${props.id}`} name="description" rows={4} maxLength={8000} dir="auto" defaultValue={props.values.description ?? undefined} />
              </div>
              <Footer busy={busy} error={error} label={tc("save")} onCancel={() => setEditOpen(false)} />
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={withdrawOpen} onOpenChange={(o) => (setWithdrawOpen(o), setError(null))}>
        <DialogContent>
          <form onSubmit={withdraw} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t(`${kind}.withdrawTitle`)}</DialogTitle>
              <DialogDescription>
                {kind === "recommendation" && props.openActions
                  ? t("recommendation.withdrawHintActions", { n: props.openActions })
                  : t(`${kind}.withdrawHint`)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`w-reason-${props.id}`}>{t("reason")}</Label>
              <Textarea id={`w-reason-${props.id}`} name="reason" required rows={3} maxLength={4000} dir="auto" placeholder={t("reasonPlaceholder")} />
            </div>
            <Footer busy={busy} error={error} label={t("withdraw")} onCancel={() => setWithdrawOpen(false)} />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
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
