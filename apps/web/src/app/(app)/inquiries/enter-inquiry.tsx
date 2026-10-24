"use client";

import { FilePlus2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EMPLOYEE_BANDS, ENTERED_SOURCES, OWNERSHIP_TYPES, URGENCIES } from "@/lib/intake";
import { localLabel } from "@/lib/names";

type Option = { code: string; nameAr: string; nameEn: string };
const NONE = "none";

/**
 * Type in an inquiry that never touched the public form (item 8): a
 * referral, a returning client, an Etimad tender, or a company the firm
 * approached. Only what staff know is required.
 */
export function EnterInquiryDialog(props: { sectors: Option[]; services: Option[]; clients: { id: string; name: string }[] }) {
  const t = useTranslations("inbox.enter");
  const ti = useTranslations("inquiry");
  const tb = useTranslations("inbox");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<(typeof ENTERED_SOURCES)[number]>("referral");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v === "" || v === NONE ? undefined : v;
    };
    const body = {
      source,
      orgName: get("orgName"),
      orgNameAr: get("orgNameAr"),
      sector: get("sector"),
      employeeBand: get("employeeBand"),
      ownershipType: get("ownershipType"),
      contactName: get("contactName"),
      contactRole: get("contactRole"),
      email: get("email"),
      phone: get("phone"),
      preferredLanguage: get("preferredLanguage") ?? "ar",
      services: form.getAll("services").map(String),
      message: get("message"),
      urgency: get("urgency"),
      sourceClientOrgId: source === "referral" || source === "existing_client" ? get("sourceClientOrgId") : undefined,
      tenderNumber: source === "tender" ? get("tenderNumber") : undefined,
      tenderClosesOn: source === "tender" ? get("tenderClosesOn") : undefined,
    };
    if (!body.sector) return setError(t("errors.sector"));
    if (source === "existing_client" && !body.sourceClientOrgId) return setError(t("errors.client"));
    setBusy(true);
    setError(null);
    const r = await callApi("/api/intake/inquiries", "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error === "bad_request" ? t("errors.check") : tc("errors.generic"));
    setOpen(false);
    router.push(`/inquiries/${(r.data as { id: string }).id}`);
  }

  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    optional = true,
    onChange?: (v: string) => void,
    value?: string,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`ei-${name}`}>{label}</Label>
      <Select name={name} defaultValue={value ?? (optional ? NONE : undefined)} onValueChange={onChange}>
        <SelectTrigger id={`ei-${name}`} className="w-full">
          <SelectValue placeholder={t("choose")} />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE}>{t("unknown")}</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FilePlus2 />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {select(
              "source",
              t("source"),
              ENTERED_SOURCES.map((s) => ({
                value: s,
                label: tb(`sources.${s}`),
              })),
              false,
              (v) => setSource(v as typeof source),
              source,
            )}
            {source === "referral" || source === "existing_client"
              ? select(
                  "sourceClientOrgId",
                  source === "referral" ? t("referredBy") : t("client"),
                  props.clients.map((c) => ({ value: c.id, label: c.name })),
                  source === "referral",
                )
              : null}
            {source === "tender" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="ei-tenderNumber">{t("tenderNumber")}</Label>
                  <Input id="ei-tenderNumber" name="tenderNumber" required dir="ltr" maxLength={40} pattern="[0-9A-Za-z\-]{1,40}" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ei-tenderClosesOn">{t("tenderClosesOn")}</Label>
                  <DatePicker id="ei-tenderClosesOn" name="tenderClosesOn" placeholder={t("tenderClosesOn")} clearLabel={tc("clear")} />
                </div>
              </>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ei-orgName">{ti("org.name")}</Label>
              <Input id="ei-orgName" name="orgName" required maxLength={200} dir="auto" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ei-orgNameAr">{ti("org.nameAr")}</Label>
              <Input id="ei-orgNameAr" name="orgNameAr" maxLength={200} dir="rtl" />
            </div>
            {select(
              "sector",
              ti("org.sector"),
              props.sectors.map((s) => ({
                value: s.code,
                label: localLabel(s, ar),
              })),
              false,
            )}
            {select(
              "ownershipType",
              ti("org.ownership"),
              OWNERSHIP_TYPES.map((o) => ({
                value: o,
                label: ti(`ownershipType.${o}`),
              })),
            )}
            {select(
              "employeeBand",
              ti("org.size"),
              EMPLOYEE_BANDS.map((b) => ({
                value: b,
                label: ti(`employeeBand.${b}`),
              })),
            )}
            {select(
              "urgency",
              tb("urgency"),
              URGENCIES.map((u) => ({ value: u, label: ti(`urgency.${u}`) })),
            )}
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{tb("services")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {props.services.map((s) => (
                <Label key={s.code} className="flex items-center gap-2 font-normal">
                  <Checkbox name="services" value={s.code} />
                  <span>{localLabel(s, ar)}</span>
                </Label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ei-contactName">{t("contactName")}</Label>
              <Input id="ei-contactName" name="contactName" maxLength={120} dir="auto" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ei-contactRole">{t("contactRole")}</Label>
              <Input id="ei-contactRole" name="contactRole" maxLength={120} dir="auto" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ei-email">{t("email")}</Label>
              <Input id="ei-email" name="email" type="email" maxLength={254} dir="ltr" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ei-phone">{t("phone")}</Label>
              <Input id="ei-phone" name="phone" maxLength={30} dir="ltr" pattern="[+0-9 ()\-]{0,30}" />
            </div>
            {select(
              "preferredLanguage",
              ti("contact.language"),
              [
                { value: "ar", label: ti("contact.ar") },
                { value: "en", label: ti("contact.en") },
              ],
              false,
              undefined,
              "ar",
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ei-message">{t("notes")}</Label>
            <Textarea id="ei-message" name="message" maxLength={2000} rows={3} dir="auto" placeholder={t("notesPlaceholder")} />
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
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
