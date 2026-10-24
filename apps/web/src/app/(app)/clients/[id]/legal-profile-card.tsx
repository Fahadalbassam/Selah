"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEGAL_FORMS, type LegalForm } from "@/lib/assessments";
import { FISCAL_CALENDARS, LISTED_MARKETS, REGULATORS, SAUDI_REGIONS, SIZE_BANDS } from "@/lib/client-profile";

export interface LegalProfile {
  legalNameAr: string | null;
  legalNameEn: string | null;
  tradeName: string | null;
  unifiedNumber: string | null;
  isicCode: string | null;
  sectorCode: string | null;
  sizeBand: string | null;
  revenueBand: string | null;
  region: string | null;
  regulators: string[];
  listedMarket: string | null;
  fiscalYearEndMonth: number | null;
  fiscalCalendar: "gregorian" | "hijri";
}

interface Props {
  clientId: string;
  profile: LegalProfile | null;
  legalForm: LegalForm | null;
  minimalRecords: boolean;
  sectors: { code: string; nameAr: string; nameEn: string }[];
  /** Every sector's name, for showing the recorded one. */
  sectorName: string | null;
  can: { edit: boolean; legalForm: boolean };
}

const NONE = "none";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The client's legal identity, as the firm recorded it (wave 1, item 7). */
export function LegalProfileCard(props: Props) {
  const t = useTranslations("legalProfile");
  const tq = useTranslations("assessment.question");
  const p = props.profile;
  const month = p?.fiscalYearEndMonth ? t(`months.${p.fiscalCalendar}.${p.fiscalYearEndMonth}`) : null;
  const rows: [string, React.ReactNode][] = [
    [t("legalForm"), props.legalForm ? tq(`forms.${props.legalForm}`) : null],
    ...(props.minimalRecords
      ? []
      : ([
          [t("legalNameAr"), p?.legalNameAr ? <span dir="rtl">{p.legalNameAr}</span> : null],
          [t("legalNameEn"), p?.legalNameEn ? <span dir="ltr">{p.legalNameEn}</span> : null],
          [t("tradeName"), p?.tradeName ? <span dir="auto">{p.tradeName}</span> : null],
          [t("unifiedNumber"), p?.unifiedNumber ? <span dir="ltr" className="font-mono tabular-nums">{p.unifiedNumber}</span> : null],
        ] as [string, React.ReactNode][])),
    [t("sector"), props.sectorName],
    [t("isicCode"), p?.isicCode ? <span className="font-mono tabular-nums">{p.isicCode}</span> : null],
    [t("sizeBand"), p?.sizeBand ? t(`employees.${p.sizeBand}`) : null],
    [t("revenueBand"), p?.revenueBand ? t(`revenue.${p.revenueBand}`) : null],
    [t("region"), p?.region ? t(`regions.${p.region}`) : null],
    [t("regulators"), p?.regulators.length ? p.regulators.map((r) => t(`regulatorNames.${r}`)).join("، ") : null],
    [t("listedMarket"), p?.listedMarket ? t(`markets.${p.listedMarket}`) : null],
    [t("fiscalYearEnd"), month ? t("fiscalYearEndValue", { month, calendar: t(`calendars.${p!.fiscalCalendar}`) }) : null],
  ];

  return (
    <Card className="h-fit gap-4 py-5 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{props.minimalRecords ? t("hintMinimal") : t("hint")}</CardDescription>
        </div>
        {props.can.edit ? <ProfileDialog {...props} /> : null}
      </CardHeader>
      <CardContent className="px-5">
        <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value ?? <span className="text-muted-foreground">{t("notRecorded")}</span>}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Choice(props: { name: string; label: string; value: string | null; options: { value: string; label: string }[]; onChange?: (v: string) => void; optional?: boolean }) {
  const t = useTranslations("legalProfile");
  return (
    <div className="grid gap-2">
      <Label htmlFor={`lp-${props.name}`}>{props.label}</Label>
      <Select name={props.name} defaultValue={props.value ?? (props.optional === false ? props.options[0]?.value : NONE)} onValueChange={props.onChange}>
        <SelectTrigger id={`lp-${props.name}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.optional === false ? null : <SelectItem value={NONE}>{t("notRecorded")}</SelectItem>}
          {props.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProfileDialog(props: Props) {
  const t = useTranslations("legalProfile");
  const tq = useTranslations("assessment.question");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const p = props.profile;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<string>(p?.fiscalCalendar ?? "gregorian");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v === "" || v === NONE ? null : v;
    };
    const body: Record<string, unknown> = {
      legalNameAr: props.minimalRecords ? null : get("legalNameAr"),
      legalNameEn: props.minimalRecords ? null : get("legalNameEn"),
      tradeName: props.minimalRecords ? null : get("tradeName"),
      unifiedNumber: props.minimalRecords ? null : get("unifiedNumber"),
      isicCode: get("isicCode"),
      sectorCode: get("sectorCode"),
      sizeBand: get("sizeBand"),
      revenueBand: get("revenueBand"),
      region: get("region"),
      regulators: form.getAll("regulators").map(String),
      listedMarket: get("listedMarket"),
      fiscalYearEndMonth: get("fiscalYearEndMonth"),
      fiscalCalendar: get("fiscalCalendar") ?? "gregorian",
    };
    if (props.can.legalForm) body.legalForm = get("legalForm");
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/orgs/${props.clientId}/profile`, "PUT", body);
    setBusy(false);
    if (!r.ok) {
      const m = r.message ?? "";
      if (m.includes("unified number")) return setError(m.includes("another client") ? t("errors.taken") : t("errors.unifiedNumber"));
      if (m.includes("listed market")) return setError(t("errors.listed"));
      if (r.error === "bad_request") return setError(t("errors.format"));
      return setError(tc(r.error === "conflict" ? "errors.conflict" : "errors.generic"));
    }
    setOpen(false);
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil />
          {tq("change")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{props.minimalRecords ? t("hintMinimal") : t("editHint")}</DialogDescription>
          </DialogHeader>
          {props.minimalRecords ? null : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="lp-legalNameAr">{t("legalNameAr")}</Label>
                  <Input id="lp-legalNameAr" name="legalNameAr" dir="rtl" maxLength={300} defaultValue={p?.legalNameAr ?? undefined} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lp-legalNameEn">{t("legalNameEn")}</Label>
                  <Input id="lp-legalNameEn" name="legalNameEn" dir="ltr" maxLength={300} defaultValue={p?.legalNameEn ?? undefined} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="lp-tradeName">{t("tradeName")}</Label>
                  <Input id="lp-tradeName" name="tradeName" dir="auto" maxLength={200} defaultValue={p?.tradeName ?? undefined} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lp-unifiedNumber">{t("unifiedNumber")}</Label>
                  <Input
                    id="lp-unifiedNumber"
                    name="unifiedNumber"
                    dir="ltr"
                    inputMode="numeric"
                    pattern="7[0-9]{9}"
                    maxLength={10}
                    placeholder="7XXXXXXXXX"
                    defaultValue={p?.unifiedNumber ?? undefined}
                  />
                  <p className="text-xs text-muted-foreground">{t("unifiedNumberHint")}</p>
                </div>
              </div>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {props.can.legalForm ? (
              <Choice name="legalForm" label={t("legalForm")} value={props.legalForm} options={LEGAL_FORMS.map((f) => ({ value: f, label: tq(`forms.${f}`) }))} />
            ) : null}
            <Choice
              name="sectorCode"
              label={t("sector")}
              value={p?.sectorCode ?? null}
              options={props.sectors.map((s) => ({ value: s.code, label: ar ? s.nameAr : s.nameEn }))}
            />
            <div className="grid gap-2">
              <Label htmlFor="lp-isicCode">{t("isicCode")}</Label>
              <Input id="lp-isicCode" name="isicCode" dir="ltr" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} defaultValue={p?.isicCode ?? undefined} />
              <p className="text-xs text-muted-foreground">{t("isicHint")}</p>
            </div>
            <Choice name="region" label={t("region")} value={p?.region ?? null} options={SAUDI_REGIONS.map((r) => ({ value: r, label: t(`regions.${r}`) }))} />
            <Choice name="sizeBand" label={t("sizeBand")} value={p?.sizeBand ?? null} options={SIZE_BANDS.map((b) => ({ value: b, label: t(`employees.${b}`) }))} />
            <Choice name="revenueBand" label={t("revenueBand")} value={p?.revenueBand ?? null} options={SIZE_BANDS.map((b) => ({ value: b, label: t(`revenue.${b}`) }))} />
            <Choice name="listedMarket" label={t("listedMarket")} value={p?.listedMarket ?? null} options={LISTED_MARKETS.map((m) => ({ value: m, label: t(`markets.${m}`) }))} />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("bandsHint")}</p>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("regulators")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REGULATORS.map((r) => (
                <Label key={r} className="flex items-center gap-2 font-normal">
                  <Checkbox name="regulators" value={r} defaultChecked={p?.regulators.includes(r)} />
                  <span>{t(`regulatorNames.${r}`)}</span>
                </Label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              name="fiscalCalendar"
              label={t("calendar")}
              value={calendar}
              optional={false}
              onChange={setCalendar}
              options={FISCAL_CALENDARS.map((c) => ({ value: c, label: t(`calendars.${c}`) }))}
            />
            <Choice
              key={calendar}
              name="fiscalYearEndMonth"
              label={t("fiscalYearEnd")}
              value={p?.fiscalYearEndMonth ? String(p.fiscalYearEndMonth) : null}
              options={MONTHS.map((m) => ({ value: String(m), label: t(`months.${calendar}.${m}`) }))}
            />
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
              {busy ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
