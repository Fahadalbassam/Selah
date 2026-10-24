"use client";

import { CalendarPlus, Handshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { EngagementFields, engagementBody, engagementError } from "@/components/engagement-form";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ENGAGEMENT_MODES } from "@/lib/engagement";
import { localInstant } from "@/lib/meetings";

const MODES = ["video", "in_person", "phone"] as const;

function useSubmit() {
  const t = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => ReturnType<typeof callApi>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(t(`errors.${r.error}`));
    return r;
  };
  return { busy, error, setError, run };
}

function Footer({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  const t = useTranslations("common");
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("cancel")}
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? <BrandLoader tone="current" className="size-4" /> : null}
        {busy ? t("saving") : label}
      </Button>
    </DialogFooter>
  );
}

/** Book the discovery session at a date and time in the firm's time zone. */
export function BookDiscovery({ inquiryId, secondary = false }: { inquiryId: string; secondary?: boolean }) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string>("video");
  const { busy, error, setError, run } = useSubmit();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const at = localInstant(String(form.get("date") ?? ""), String(form.get("time") ?? ""));
    if (!at) return setError(t("date"));
    const attendees = String(form.get("attendees") ?? "").trim();
    const r = await run(() =>
      callApi(`/api/intake/inquiries/${inquiryId}/discovery`, "POST", {
        scheduledAt: at.toISOString(),
        mode,
        ...(attendees ? { attendees } : {}),
      }),
    );
    if (r.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button variant={secondary ? "outline" : "default"}>
          <CalendarPlus />
          {t("book")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("book")}</DialogTitle>
            <DialogDescription>{t("bookHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="d-date">{t("date")}</Label>
              <DatePicker id="d-date" name="date" required placeholder={t("date")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="d-time">{t("time")}</Label>
              <Input id="d-time" name="time" type="time" defaultValue="10:00" required dir="ltr" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t("mode")}</Label>
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v)} className="w-fit">
              {MODES.map((m) => (
                <ToggleGroupItem key={m} value={m} className="px-3">
                  {t(`modes.${m}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="d-att">{t("attendees")}</Label>
            <Textarea id="d-att" name="attendees" rows={2} maxLength={1000} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Footer busy={busy} label={t("book")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Win the inquiry: a new or existing client, its lead, and optionally the first project. */
export function ConvertDialog(props: {
  inquiryId: string;
  orgName: string;
  orgNameAr: string | null;
  clients: { id: string; name: string }[];
  consultants: { id: string; name: string }[];
  /** A returning client's inquiry starts on that client. */
  existingClientId?: string | null;
}) {
  const t = useTranslations("inbox");
  const te = useTranslations("engagements");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"new" | "existing">(props.existingClientId ? "existing" : "new");
  const { busy, error, setError, run } = useSubmit();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const client =
      kind === "new"
        ? { name: get("name"), ...(get("nameAr") ? { nameAr: get("nameAr") } : {}), engagementMode: get("engagementMode") }
        : { existingClientId: get("existingClientId") };
    const lead = get("leadUserId");
    const r = await run(() =>
      callApi(`/api/intake/inquiries/${props.inquiryId}/convert`, "POST", {
        client,
        ...(lead && lead !== "none" ? { leadUserId: lead } : {}),
        ...(get("projectTitle") ? { projectTitle: get("projectTitle") } : {}),
        // What the client signed; the first project starts under it.
        engagement: Object.fromEntries(Object.entries(engagementBody(form)).filter(([, v]) => v !== undefined)),
      }),
    );
    if (!r.ok) setError(engagementError(te, tc, r));
    if (r.ok) {
      setOpen(false);
      router.push(`/clients/${(r.data as { clientOrgId: string }).clientOrgId}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button className="w-full">
          <Handshake />
          {t("convert")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("convert")}</DialogTitle>
            <DialogDescription>{t("convertHint")}</DialogDescription>
          </DialogHeader>
          {props.clients.length ? (
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => v && setKind(v as "new" | "existing")}
              className="w-fit"
            >
              <ToggleGroupItem value="new" className="px-3">
                {t("newClient")}
              </ToggleGroupItem>
              <ToggleGroupItem value="existing" className="px-3">
                {t("existingClient")}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {kind === "new" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="c-name">{t("clientName")}</Label>
                <Input id="c-name" name="name" required minLength={2} maxLength={200} defaultValue={props.orgName} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-name-ar">{t("clientNameAr")}</Label>
                <Input id="c-name-ar" name="nameAr" maxLength={200} dir="rtl" defaultValue={props.orgNameAr ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="c-mode">{t("engagementMode")}</Label>
                <Select name="engagementMode" defaultValue="full">
                  <SelectTrigger id="c-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGAGEMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`engagementModes.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="c-existing">{t("existingClient")}</Label>
              <Select name="existingClientId" required defaultValue={props.existingClientId ?? undefined}>
                <SelectTrigger id="c-existing" className="w-full">
                  <SelectValue placeholder={t("chooseClient")} />
                </SelectTrigger>
                <SelectContent>
                  {props.clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="c-lead">{t("lead")}</Label>
            <Select name="leadUserId" defaultValue="none">
              <SelectTrigger id="c-lead" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("noLead")}</SelectItem>
                {props.consultants.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-project">{t("projectTitle")}</Label>
            <Input id="c-project" name="projectTitle" minLength={2} maxLength={200} />
          </div>
          <fieldset className="grid gap-4 border-t pt-4">
            <legend className="sr-only">{te("signedSection")}</legend>
            <div className="space-y-1">
              <p className="text-sm font-medium">{te("signedSection")}</p>
              <p className="text-xs text-muted-foreground">{te("signedSectionHint")}</p>
            </div>
            <EngagementFields prefix="cv" />
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Footer busy={busy} label={t("convert")} onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
