"use client";

import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";
import { Highlight, HighlightItem } from "@animate-ui/react/primitives/effects/highlight";
import { HighlightText } from "@animate-ui/react/primitives/texts/highlight";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "@/components/animate-ui/icons/arrow-left";
import { ArrowRight } from "@/components/animate-ui/icons/arrow-right";
import { Check } from "@/components/animate-ui/icons/check";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Copy } from "@/components/animate-ui/icons/copy";
import { Send } from "@/components/animate-ui/icons/send";
import { BrandLoader } from "@/components/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SELF_CHECKS } from "@/lib/intake";
import { cn } from "@/lib/utils";

interface Choice {
  code: string;
  label: string;
}

export interface InquiryOptions {
  services: Choice[];
  sectors: Choice[];
  employeeBands: string[];
  ownershipTypes: string[];
  urgencies: string[];
  heardFrom: string[];
  privacyNoticeVersion: string;
}

type SelfCheckKey = (typeof SELF_CHECKS)[number];

interface Answers {
  orgName: string;
  orgNameAr: string;
  crNumber: string;
  sector: string;
  employeeBand: string;
  ownershipType: string;
  contactName: string;
  contactRole: string;
  email: string;
  phone: string;
  preferredLanguage: "ar" | "en";
  services: string[];
  message: string;
  urgency: string;
  heardFrom: string;
  selfCheck: Partial<Record<SelfCheckKey, boolean>>;
  consent: boolean;
}

const STEPS = ["org", "contact", "needs", "today", "review"] as const;
type Step = (typeof STEPS)[number];

/** Which step each API field lives on, to route server errors back to it. */
const FIELD_STEP: Record<string, number> = {
  orgName: 0, orgNameAr: 0, crNumber: 0, sector: 0, employeeBand: 0, ownershipType: 0,
  contactName: 1, contactRole: 1, email: 1, phone: 1, preferredLanguage: 1,
  services: 2, message: 2, urgency: 2, heardFrom: 2,
  selfCheck: 3,
  consent: 4, privacyNoticeVersion: 4,
};

function without<T extends object>(obj: T, key: PropertyKey): T {
  const copy = { ...obj };
  delete copy[key as keyof T];
  return copy;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 2000;

/** Client-side checks mirror the API's; the server and database check again. */
function validate(step: number, a: Answers): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0) {
    if (!a.orgName.trim()) e.orgName = "required";
    if (a.crNumber && !/^[0-9]{1,20}$/.test(a.crNumber.trim())) e.crNumber = "cr";
    if (!a.sector) e.sector = "required";
    if (!a.employeeBand) e.employeeBand = "required";
    if (!a.ownershipType) e.ownershipType = "required";
  }
  if (step === 1) {
    if (!a.contactName.trim()) e.contactName = "required";
    if (!EMAIL.test(a.email.trim())) e.email = a.email.trim() ? "email" : "required";
    if (a.phone && !/^[+0-9 ()-]{1,30}$/.test(a.phone.trim())) e.phone = "phone";
  }
  if (step === 2 && a.services.length === 0) e.services = "services";
  if (step === 4 && !a.consent) e.consent = "consent";
  return e;
}

export function InquiryForm({ options, locale }: { options: InquiryOptions; locale: "ar" | "en" }) {
  const t = useTranslations("inquiry");
  const rtl = locale === "ar";
  const empty: Answers = {
    orgName: "", orgNameAr: "", crNumber: "", sector: "", employeeBand: "", ownershipType: "",
    contactName: "", contactRole: "", email: "", phone: "", preferredLanguage: locale,
    services: [], message: "", urgency: "", heardFrom: "", selfCheck: {}, consent: false,
  };
  const [a, setA] = useState<Answers>(empty);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  // +1 moving forward, -1 back: decides which side the next panel enters from.
  const [heading, setHeading] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ ref: string; email: string } | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setA((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => without(prev, key));
  };

  function go(to: number) {
    setHeading(to > step ? 1 : -1);
    setStep(to);
    setReached((r) => Math.max(r, to));
    setNotice(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function next() {
    const e = validate(step, a);
    setErrors(e);
    if (Object.keys(e).length === 0) go(step + 1);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (step < STEPS.length - 1) return next();
    for (let s = 0; s < STEPS.length; s++) {
      const e = validate(s, a);
      if (Object.keys(e).length) {
        setErrors(e);
        if (s !== step) go(s);
        return;
      }
    }
    setBusy(true);
    setNotice(null);
    const opt = (v: string) => v.trim() || undefined;
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgName: a.orgName.trim(),
          orgNameAr: opt(a.orgNameAr),
          crNumber: opt(a.crNumber),
          sector: a.sector,
          employeeBand: a.employeeBand,
          ownershipType: a.ownershipType,
          contactName: a.contactName.trim(),
          contactRole: opt(a.contactRole),
          email: a.email.trim(),
          phone: opt(a.phone),
          preferredLanguage: a.preferredLanguage,
          services: a.services,
          message: opt(a.message),
          selfCheck: a.selfCheck,
          urgency: a.urgency || undefined,
          heardFrom: a.heardFrom || undefined,
          consent: a.consent,
          privacyNoticeVersion: options.privacyNoticeVersion,
          website: honeypot.current?.value || undefined,
        }),
      });
      if (res.status === 201) {
        const { ref } = (await res.json()) as { ref: string };
        setSent({ ref, email: a.email.trim() });
        return;
      }
      if (res.status === 429) return setNotice("rateLimited");
      if (res.status === 400) {
        const { fields = [] } = (await res.json().catch(() => ({}))) as { fields?: string[] };
        if (fields.includes("privacyNoticeVersion")) return setNotice("stale");
        const first = Math.min(...fields.map((f) => FIELD_STEP[f] ?? 4), 4);
        setErrors(Object.fromEntries(fields.map((f) => [f, "required"])));
        go(first);
        return setNotice("server");
      }
      setNotice("failed");
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Sent
        refCode={sent.ref}
        email={sent.email}
        onAgain={() => {
          setA(empty);
          setSent(null);
          setStep(0);
          setReached(0);
        }}
      />
    );
  }

  const err = (k: string) => (errors[k] ? t(`errors.${errors[k]}`) : undefined);
  const Forward = rtl ? ArrowLeft : ArrowRight;
  const Backward = rtl ? ArrowRight : ArrowLeft;
  const current: Step = STEPS[step]!;

  return (
    <Card ref={top} className="scroll-mt-24 gap-0 overflow-hidden py-0 shadow-sm lg:self-start">
      <StepNav step={step} reached={reached} onPick={go} />
      <form onSubmit={submit} noValidate className="flex flex-col">
        {/* Honeypot: off-screen and skipped by keyboard and screen readers. */}
        <div aria-hidden className="absolute -start-[9999px] size-px overflow-hidden">
          <label>
            {t("honeypot")}
            <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <AutoHeight deps={[step, Object.keys(errors).length, notice]} transition={{ type: "spring", stiffness: 260, damping: 32 }}>
          <AnimatePresence mode="wait" initial={false} custom={heading}>
            <motion.div
              key={current}
              custom={heading}
              variants={{
                enter: (h: number) => ({ opacity: 0, x: (rtl ? -1 : 1) * h * 24 }),
                center: { opacity: 1, x: 0 },
                exit: (h: number) => ({ opacity: 0, x: (rtl ? 1 : -1) * h * 24 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="p-6"
            >
              {notice ? (
                <Alert variant={notice === "server" ? "default" : "destructive"} className="mb-6">
                  <AlertDescription>{t(`errors.${notice}`)}</AlertDescription>
                </Alert>
              ) : null}

              {current === "org" ? (
                <FieldGroup>
                  <Field data-invalid={!!errors.orgName}>
                    <FieldLabel htmlFor="orgName">{t("org.name")}</FieldLabel>
                    <Input id="orgName" value={a.orgName} onChange={(e) => set("orgName", e.target.value)} maxLength={200} autoComplete="organization" aria-invalid={!!errors.orgName} autoFocus />
                    {err("orgName") ? <FieldError>{err("orgName")}</FieldError> : <FieldDescription>{t("org.nameHint")}</FieldDescription>}
                  </Field>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="orgNameAr">{t("org.nameAr")}</FieldLabel>
                      <Input id="orgNameAr" dir="rtl" lang="ar" value={a.orgNameAr} onChange={(e) => set("orgNameAr", e.target.value)} maxLength={200} />
                      <FieldDescription>{t("org.nameArHint")}</FieldDescription>
                    </Field>
                    <Field data-invalid={!!errors.crNumber}>
                      <FieldLabel htmlFor="crNumber">{t("org.cr")}</FieldLabel>
                      <Input id="crNumber" dir="ltr" inputMode="numeric" value={a.crNumber} onChange={(e) => set("crNumber", e.target.value)} maxLength={20} aria-invalid={!!errors.crNumber} />
                      {err("crNumber") ? <FieldError>{err("crNumber")}</FieldError> : <FieldDescription>{t("org.crHint")}</FieldDescription>}
                    </Field>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field data-invalid={!!errors.sector}>
                      <FieldLabel htmlFor="sector">{t("org.sector")}</FieldLabel>
                      <Select value={a.sector} onValueChange={(v) => set("sector", v)}>
                        <SelectTrigger id="sector" className="w-full" aria-invalid={!!errors.sector}>
                          <SelectValue placeholder={t("org.sectorPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.sectors.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err("sector") ? <FieldError>{err("sector")}</FieldError> : null}
                    </Field>
                    <Field data-invalid={!!errors.ownershipType}>
                      <FieldLabel htmlFor="ownershipType">{t("org.ownership")}</FieldLabel>
                      <Select value={a.ownershipType} onValueChange={(v) => set("ownershipType", v)}>
                        <SelectTrigger id="ownershipType" className="w-full" aria-invalid={!!errors.ownershipType}>
                          <SelectValue placeholder={t("org.ownershipPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.ownershipTypes.map((o) => (
                            <SelectItem key={o} value={o}>
                              {t(`ownershipType.${o}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err("ownershipType") ? <FieldError>{err("ownershipType")}</FieldError> : null}
                    </Field>
                  </div>
                  <FieldSet data-invalid={!!errors.employeeBand}>
                    <FieldLegend variant="label">{t("org.size")}</FieldLegend>
                    <RadioGroup value={a.employeeBand} onValueChange={(v) => set("employeeBand", v)} className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-invalid={!!errors.employeeBand}>
                      {options.employeeBands.map((b) => (
                        <FieldLabel key={b} htmlFor={`band-${b}`}>
                          <Field orientation="horizontal" className="p-3!">
                            <RadioGroupItem value={b} id={`band-${b}`} />
                            <FieldTitle className="tabular-nums">
                              <bdi dir="ltr">{t(`employeeBand.${b}`)}</bdi>
                            </FieldTitle>
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                    {err("employeeBand") ? <FieldError>{err("employeeBand")}</FieldError> : null}
                  </FieldSet>
                </FieldGroup>
              ) : null}

              {current === "contact" ? (
                <FieldGroup>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field data-invalid={!!errors.contactName}>
                      <FieldLabel htmlFor="contactName">{t("contact.name")}</FieldLabel>
                      <Input id="contactName" value={a.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={120} autoComplete="name" aria-invalid={!!errors.contactName} autoFocus />
                      {err("contactName") ? <FieldError>{err("contactName")}</FieldError> : null}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="contactRole">{t("contact.role")}</FieldLabel>
                      <Input id="contactRole" value={a.contactRole} onChange={(e) => set("contactRole", e.target.value)} maxLength={120} autoComplete="organization-title" />
                      <FieldDescription>{t("contact.roleHint")}</FieldDescription>
                    </Field>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field data-invalid={!!errors.email}>
                      <FieldLabel htmlFor="email">{t("contact.email")}</FieldLabel>
                      <Input id="email" type="email" dir="ltr" value={a.email} onChange={(e) => set("email", e.target.value)} maxLength={254} autoComplete="email" aria-invalid={!!errors.email} />
                      {err("email") ? <FieldError>{err("email")}</FieldError> : null}
                    </Field>
                    <Field data-invalid={!!errors.phone}>
                      <FieldLabel htmlFor="phone">{t("contact.phone")}</FieldLabel>
                      <Input id="phone" type="tel" dir="ltr" value={a.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} autoComplete="tel" aria-invalid={!!errors.phone} />
                      {err("phone") ? <FieldError>{err("phone")}</FieldError> : <FieldDescription>{t("contact.phoneHint")}</FieldDescription>}
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel id="langLabel">{t("contact.language")}</FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      aria-labelledby="langLabel"
                      value={a.preferredLanguage}
                      onValueChange={(v) => v && set("preferredLanguage", v as "ar" | "en")}
                    >
                      <ToggleGroupItem value="ar" className="px-4">{t("contact.ar")}</ToggleGroupItem>
                      <ToggleGroupItem value="en" className="px-4">{t("contact.en")}</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                </FieldGroup>
              ) : null}

              {current === "needs" ? (
                <FieldGroup>
                  <FieldSet data-invalid={!!errors.services}>
                    <FieldLegend variant="label">{t("needs.services")}</FieldLegend>
                    <FieldDescription>{t("needs.servicesHint")}</FieldDescription>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {options.services.map((s) => {
                        const on = a.services.includes(s.code);
                        return (
                          <FieldLabel key={s.code} htmlFor={`svc-${s.code}`}>
                            <Field orientation="horizontal" className="p-3!">
                              <Checkbox
                                id={`svc-${s.code}`}
                                checked={on}
                                onCheckedChange={(c) =>
                                  set("services", c ? [...a.services, s.code] : a.services.filter((x) => x !== s.code))
                                }
                              />
                              <FieldTitle>{s.label}</FieldTitle>
                            </Field>
                          </FieldLabel>
                        );
                      })}
                    </div>
                    {err("services") ? <FieldError>{err("services")}</FieldError> : null}
                  </FieldSet>
                  <Field>
                    <FieldLabel htmlFor="message">{t("needs.message")}</FieldLabel>
                    <Textarea id="message" value={a.message} onChange={(e) => set("message", e.target.value)} maxLength={MESSAGE_MAX} rows={4} className="resize-none" />
                    <FieldDescription className="flex justify-between gap-4">
                      <span>{t("needs.messageHint")}</span>
                      <span className="shrink-0 tabular-nums">
                        {a.message.length}/{MESSAGE_MAX}
                      </span>
                    </FieldDescription>
                  </Field>
                  <div className="grid gap-6">
                    <Field>
                      <FieldLabel id="urgencyLabel">{t("needs.urgency")}</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        aria-labelledby="urgencyLabel"
                        value={a.urgency}
                        onValueChange={(v) => set("urgency", v)}
                        className="w-full"
                      >
                        {options.urgencies.map((u) => (
                          <ToggleGroupItem key={u} value={u} className="flex-1 px-3">
                            {t(`urgency.${u}`)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                    <Field className="sm:max-w-xs">
                      <FieldLabel htmlFor="heardFrom">{t("needs.heardFrom")}</FieldLabel>
                      <Select value={a.heardFrom} onValueChange={(v) => set("heardFrom", v)}>
                        <SelectTrigger id="heardFrom" className="w-full">
                          <SelectValue placeholder={t("needs.heardFromPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.heardFrom.map((h) => (
                            <SelectItem key={h} value={h}>
                              {t(`heardFromOption.${h}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
              ) : null}

              {current === "today" ? (
                <div className="space-y-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("today.intro")}</p>
                  <ItemGroup className="divide-y rounded-lg border">
                    {SELF_CHECKS.map((k) => {
                      const v = a.selfCheck[k];
                      return (
                        <Item key={k} size="sm" className="rounded-none">
                          <ItemContent>
                            <ItemTitle id={`sc-${k}`}>{t(`selfCheck.${k}`)}</ItemTitle>
                          </ItemContent>
                          <ItemActions>
                            <ToggleGroup
                              type="single"
                              variant="outline"
                              size="sm"
                              aria-labelledby={`sc-${k}`}
                              value={v === undefined ? "" : v ? "yes" : "no"}
                              onValueChange={(nv) => {
                                const rest = without(a.selfCheck, k);
                                set("selfCheck", nv ? { ...rest, [k]: nv === "yes" } : rest);
                              }}
                            >
                              <ToggleGroupItem value="yes" className="px-3">{t("today.yes")}</ToggleGroupItem>
                              <ToggleGroupItem value="no" className="px-3">{t("today.no")}</ToggleGroupItem>
                            </ToggleGroup>
                          </ItemActions>
                        </Item>
                      );
                    })}
                  </ItemGroup>
                  <p className="text-xs text-muted-foreground">{t("today.skip")}</p>
                </div>
              ) : null}

              {current === "review" ? (
                <Review answers={a} options={options} onEdit={go} errors={errors} onConsent={(c) => set("consent", c)} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-6 py-4">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => go(step - 1)} disabled={busy}>
              <Backward animateOnHover />
              {t("back")}
            </Button>
          ) : (
            <span />
          )}
          {current === "review" ? (
            <Button type="submit" disabled={busy} className="min-w-36">
              {busy ? <BrandLoader tone="current" className="size-4" /> : <Send animateOnHover className="rtl:-scale-x-100" />}
              {busy ? t("sending") : t("send")}
            </Button>
          ) : (
            <Button type="submit" className="min-w-32">
              {t("next")}
              <Forward animateOnHover />
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/** Step names along the top. The pill slides to the current step. */
function StepNav({ step, reached, onPick }: { step: number; reached: number; onPick: (s: number) => void }) {
  const t = useTranslations("inquiry");
  return (
    <div className="space-y-3 border-b px-6 pt-5 pb-4">
      <p className="text-xs font-medium text-muted-foreground tabular-nums">
        {t("stepOf", { current: step + 1, total: STEPS.length })}
      </p>
      <nav aria-label={t("stepOf", { current: step + 1, total: STEPS.length })}>
        <Highlight
          value={STEPS[step]}
          click={false}
          hover={false}
          mode="parent"
          controlledItems
          containerClassName="grid grid-cols-5 gap-1"
          className="rounded-md bg-muted ring-1 ring-border"
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
        >
          {STEPS.map((s, i) => (
            <HighlightItem key={s} value={s} activeClassName="text-foreground">
              <button
                type="button"
                disabled={i > reached}
                aria-current={i === step ? "step" : undefined}
                onClick={() => onPick(i)}
                className={cn(
                  "relative flex w-full min-w-0 flex-col items-center gap-1 rounded-md px-1 py-2 text-xs text-muted-foreground transition-colors outline-none",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:text-foreground disabled:opacity-50",
                  i === step && "font-medium text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border bg-background text-[11px] tabular-nums transition-colors",
                    i < step && "border-foreground bg-foreground text-background",
                    i === step && "border-foreground",
                  )}
                >
                  {i < step ? <Check animate className="size-3.5" /> : i + 1}
                </span>
                <span className="w-full truncate text-center">{t(`steps.${s}`)}</span>
              </button>
            </HighlightItem>
          ))}
        </Highlight>
      </nav>
    </div>
  );
}

function Review({
  answers: a,
  options,
  onEdit,
  errors,
  onConsent,
}: {
  answers: Answers;
  options: InquiryOptions;
  onEdit: (step: number) => void;
  errors: Record<string, string>;
  onConsent: (c: boolean) => void;
}) {
  const t = useTranslations("inquiry");
  const label = (list: Choice[], code: string) => list.find((c) => c.code === code)?.label ?? code;
  const none = <span className="text-muted-foreground">{t("review.notAnswered")}</span>;
  const answered = SELF_CHECKS.filter((k) => a.selfCheck[k] !== undefined);
  const sections: { step: number; rows: [string, React.ReactNode][] }[] = [
    {
      step: 0,
      rows: [
        [t("org.name"), [a.orgName, a.orgNameAr].filter(Boolean).join(" · ")],
        [t("org.sector"), label(options.sectors, a.sector)],
        [t("org.size"), a.employeeBand ? <bdi key="b" dir="ltr">{t(`employeeBand.${a.employeeBand}`)}</bdi> : none],
        [t("org.ownership"), a.ownershipType ? t(`ownershipType.${a.ownershipType}`) : none],
      ],
    },
    {
      step: 1,
      rows: [
        [t("contact.name"), [a.contactName, a.contactRole].filter(Boolean).join(" · ")],
        [t("contact.email"), <bdi key="e">{a.email}</bdi>],
        [t("contact.phone"), a.phone ? <bdi key="p">{a.phone}</bdi> : none],
      ],
    },
    {
      step: 2,
      rows: [
        [t("needs.services"), a.services.map((s) => label(options.services, s)).join("، ")],
        [t("needs.urgency"), a.urgency ? t(`urgency.${a.urgency}`) : none],
      ],
    },
    {
      step: 3,
      rows: [
        [
          t("steps.today"),
          answered.length
            ? answered.map((k) => `${t(`selfCheck.${k}`)}: ${a.selfCheck[k] ? t("today.yes") : t("today.no")}`).join("، ")
            : none,
        ],
      ],
    },
  ];
  return (
    <FieldGroup>
      <p className="text-sm text-muted-foreground">{t("review.intro")}</p>
      <div className="divide-y rounded-lg border">
        {sections.map((sec) => (
          <div key={sec.step} className="flex items-start gap-4 p-4">
            <dl className="grid flex-1 gap-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              {sec.rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onEdit(sec.step)}>
              {t("review.edit")}
            </Button>
          </div>
        ))}
      </div>
      <Alert>
        <AlertDescription>{t("review.noFiles")}</AlertDescription>
      </Alert>
      <Field orientation="horizontal" data-invalid={!!errors.consent}>
        <Checkbox id="consent" checked={a.consent} onCheckedChange={(c) => onConsent(c === true)} aria-invalid={!!errors.consent} />
        <FieldContent>
          <FieldLabel htmlFor="consent" className="font-normal leading-relaxed">
            {t("review.consent")}
          </FieldLabel>
          <FieldDescription>
            <Link href="/privacy" target="_blank">
              {t("review.privacyLink")}
            </Link>
          </FieldDescription>
          {errors.consent ? <FieldError>{t("errors.consent")}</FieldError> : null}
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}

function Sent({ refCode, email, onAgain }: { refCode: string; email: string; onAgain: () => void }) {
  const t = useTranslations("inquiry");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(refCode);
      setCopied(true);
      toast.success(t("sent.copied"));
    } catch {
      // Clipboard can be blocked; the reference is still on screen to copy by hand.
    }
  }
  return (
    <Card className="animate-page-in items-center gap-6 px-6 py-12 text-center shadow-sm lg:self-start" role="status">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <CircleCheck animate className="size-7 text-success" />
      </span>
      <div className="max-w-md space-y-2">
        <h2 className="text-xl font-semibold text-balance">{t("sent.title")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.rich("sent.body", { email: () => <bdi className="text-foreground">{email}</bdi> })}
        </p>
      </div>
      <CardContent className="w-full max-w-sm space-y-2 rounded-xl border bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground">{t("sent.refLabel")}</p>
        <div className="flex items-center justify-center gap-2" dir="ltr">
          <HighlightText
            text={refCode}
            className="rounded-md bg-[linear-gradient(var(--accent),var(--accent))] bg-no-repeat px-2 py-0.5 font-mono text-xl font-semibold tracking-wider"
          />
          <Button type="button" variant="ghost" size="icon" onClick={copy} aria-label={t("sent.copy")}>
            {copied ? <Check animate className="size-4" /> : <Copy animateOnHover className="size-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("sent.refHint")}</p>
      </CardContent>
      <Button type="button" variant="outline" onClick={onAgain}>
        {t("sent.another")}
      </Button>
    </Card>
  );
}
