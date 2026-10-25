"use client";

import { CopyButton } from "@/components/copy-button";
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
import {
  CONTACT_CHANNELS,
  FAMILY_GENERATIONS,
  FAMILY_GOVERNANCE,
  FAMILY_OWNERSHIP,
  FAMILY_WORKING,
  REQUESTER_ROLES,
  SELF_CHECKS,
  WHY_NOW_MAX,
} from "@/lib/intake";
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
  sector: string;
  employeeBand: string;
  ownershipType: string;
  familyGeneration: string;
  familyWorking: string;
  familyGovernance: string;
  contactName: string;
  requesterRole: string;
  contactRole: string;
  email: string;
  phone: string;
  contactChannel: (typeof CONTACT_CHANNELS)[number];
  preferredLanguage: "ar" | "en";
  services: string[];
  whyNow: string;
  message: string;
  urgency: string;
  heardFrom: string;
  selfCheck: Partial<Record<SelfCheckKey, boolean>>;
  consent: boolean;
  marketingConsent: boolean;
}

// Size, ownership and the family questions come after the need, and are optional.
const STEPS = ["org", "contact", "needs", "about", "review"] as const;
type Step = (typeof STEPS)[number];

/** Which step each API field lives on, to route server errors back to it. */
const FIELD_STEP: Record<string, number> = {
  orgName: 0, orgNameAr: 0, sector: 0,
  contactName: 1, requesterRole: 1, contactRole: 1, email: 1, phone: 1, contactChannel: 1, preferredLanguage: 1,
  services: 2, whyNow: 2, message: 2, urgency: 2, heardFrom: 2,
  employeeBand: 3, ownershipType: 3, familyGeneration: 3, familyWorking: 3, familyGovernance: 3, selfCheck: 3,
  consent: 4, marketingConsent: 4, privacyNoticeVersion: 4,
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
    if (!a.sector) e.sector = "required";
  }
  if (step === 1) {
    if (!a.contactName.trim()) e.contactName = "required";
    if (!a.requesterRole) e.requesterRole = "required";
    if (!EMAIL.test(a.email.trim())) e.email = a.email.trim() ? "email" : "required";
    if (a.phone && !/^[+0-9 ()-]{1,30}$/.test(a.phone.trim())) e.phone = "phone";
    else if (a.contactChannel !== "email" && !a.phone.trim()) e.phone = "phoneForChannel";
  }
  if (step === 2) {
    if (a.services.length === 0) e.services = "services";
    if (!a.whyNow.trim()) e.whyNow = "whyNow";
  }
  if (step === 4 && !a.consent) e.consent = "consent";
  return e;
}

export function InquiryForm({ options, locale }: { options: InquiryOptions; locale: "ar" | "en" }) {
  const t = useTranslations("inquiry");
  const rtl = locale === "ar";
  const empty: Answers = {
    orgName: "", orgNameAr: "", sector: "", employeeBand: "", ownershipType: "",
    familyGeneration: "", familyWorking: "", familyGovernance: "",
    contactName: "", requesterRole: "", contactRole: "", email: "", phone: "", contactChannel: "email", preferredLanguage: locale,
    services: [], whyNow: "", message: "", urgency: "", heardFrom: "", selfCheck: {}, consent: false, marketingConsent: false,
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

  const family = FAMILY_OWNERSHIP.includes(a.ownershipType);
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
          sector: a.sector,
          employeeBand: a.employeeBand || undefined,
          ownershipType: a.ownershipType || undefined,
          familyGeneration: (family && a.familyGeneration) || undefined,
          familyWorking: (family && a.familyWorking) || undefined,
          familyGovernance: (family && a.familyGovernance) || undefined,
          contactName: a.contactName.trim(),
          requesterRole: a.requesterRole,
          contactRole: opt(a.contactRole),
          email: a.email.trim(),
          phone: opt(a.phone),
          contactChannel: a.contactChannel,
          preferredLanguage: a.preferredLanguage,
          services: a.services,
          whyNow: a.whyNow.trim(),
          message: opt(a.message),
          selfCheck: a.selfCheck,
          urgency: a.urgency || undefined,
          heardFrom: a.heardFrom || undefined,
          consent: a.consent,
          marketingConsent: a.marketingConsent,
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
                <Alert
                  key={notice}
                  // Sending happens at the bottom of the long review step; bring the reason into view.
                  ref={(el) => el?.scrollIntoView({ block: "center", behavior: "smooth" })}
                  variant={notice === "server" ? "default" : "destructive"}
                  className="mb-6"
                >
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
                  </div>
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
                    <Field data-invalid={!!errors.requesterRole}>
                      <FieldLabel htmlFor="requesterRole">{t("contact.role")}</FieldLabel>
                      <Select value={a.requesterRole} onValueChange={(v) => set("requesterRole", v)}>
                        <SelectTrigger id="requesterRole" className="w-full" aria-invalid={!!errors.requesterRole}>
                          <SelectValue placeholder={t("contact.rolePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {REQUESTER_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`requesterRole.${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err("requesterRole") ? <FieldError>{err("requesterRole")}</FieldError> : null}
                    </Field>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="contactRole">{t("contact.title")}</FieldLabel>
                      <Input id="contactRole" value={a.contactRole} onChange={(e) => set("contactRole", e.target.value)} maxLength={120} autoComplete="organization-title" />
                      <FieldDescription>{t("contact.titleHint")}</FieldDescription>
                    </Field>
                    <Field data-invalid={!!errors.email}>
                      <FieldLabel htmlFor="email">{t("contact.email")}</FieldLabel>
                      <Input id="email" type="email" dir="ltr" value={a.email} onChange={(e) => set("email", e.target.value)} maxLength={254} autoComplete="email" aria-invalid={!!errors.email} />
                      {err("email") ? <FieldError>{err("email")}</FieldError> : null}
                    </Field>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel id="channelLabel">{t("contact.channel")}</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        aria-labelledby="channelLabel"
                        value={a.contactChannel}
                        onValueChange={(v) => {
                          if (!v) return;
                          set("contactChannel", v as Answers["contactChannel"]);
                          setErrors((prev) => without(prev, "phone"));
                        }}
                      >
                        {CONTACT_CHANNELS.map((c) => (
                          <ToggleGroupItem key={c} value={c} className="px-4">
                            {t(`channel.${c}`)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                    <Field data-invalid={!!errors.phone}>
                      <FieldLabel htmlFor="phone">{a.contactChannel === "whatsapp" ? t("contact.whatsapp") : t("contact.phone")}</FieldLabel>
                      <Input id="phone" type="tel" dir="ltr" value={a.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} autoComplete="tel" aria-invalid={!!errors.phone} />
                      {err("phone") ? (
                        <FieldError>{err("phone")}</FieldError>
                      ) : (
                        <FieldDescription>{a.contactChannel === "email" ? t("contact.phoneHint") : t("contact.phoneNeeded")}</FieldDescription>
                      )}
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
                  <Field data-invalid={!!errors.whyNow}>
                    <FieldLabel htmlFor="whyNow">{t("needs.whyNow")}</FieldLabel>
                    <Textarea id="whyNow" value={a.whyNow} onChange={(e) => set("whyNow", e.target.value)} maxLength={WHY_NOW_MAX} rows={2} className="resize-none" aria-invalid={!!errors.whyNow} />
                    {err("whyNow") ? (
                      <FieldError>{err("whyNow")}</FieldError>
                    ) : (
                      <FieldDescription className="flex justify-between gap-4">
                        <span>{t("needs.whyNowHint")}</span>
                        <span className="shrink-0 tabular-nums">
                          {a.whyNow.length}/{WHY_NOW_MAX}
                        </span>
                      </FieldDescription>
                    )}
                  </Field>
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

              {current === "about" ? (
                <FieldGroup>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("about.intro")}</p>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="ownershipType">{t("org.ownership")}</FieldLabel>
                      <Select
                        value={a.ownershipType}
                        onValueChange={(v) => {
                          set("ownershipType", v);
                          // The family questions are for family businesses only.
                          if (!FAMILY_OWNERSHIP.includes(v)) setA((prev) => ({ ...prev, ownershipType: v, familyGeneration: "", familyWorking: "", familyGovernance: "" }));
                        }}
                      >
                        <SelectTrigger id="ownershipType" className="w-full">
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
                    </Field>
                  </div>
                  <FieldSet>
                    <FieldLegend variant="label">{t("org.size")}</FieldLegend>
                    <RadioGroup value={a.employeeBand} onValueChange={(v) => set("employeeBand", v)} className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
                  </FieldSet>
                  {family ? (
                    <FieldSet className="rounded-lg border p-4">
                      <FieldLegend variant="label">{t("family.title")}</FieldLegend>
                      <FieldDescription>{t("family.hint")}</FieldDescription>
                      <FamilyQuestion id="familyGeneration" label={t("family.generation")} value={a.familyGeneration} choices={FAMILY_GENERATIONS} prefix="family.generations" onChange={(v) => set("familyGeneration", v)} />
                      <FamilyQuestion id="familyWorking" label={t("family.working")} value={a.familyWorking} choices={FAMILY_WORKING} prefix="family.workingBands" onChange={(v) => set("familyWorking", v)} ltr />
                      <FamilyQuestion id="familyGovernance" label={t("family.governance")} value={a.familyGovernance} choices={FAMILY_GOVERNANCE} prefix="family.governances" onChange={(v) => set("familyGovernance", v)} />
                    </FieldSet>
                  ) : null}
                  <div className="space-y-3">
                    <p className="text-sm font-medium">{t("today.title")}</p>
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
                </FieldGroup>
              ) : null}

              {current === "review" ? (
                <Review
                  answers={a}
                  options={options}
                  onEdit={go}
                  errors={errors}
                  onConsent={(c) => set("consent", c)}
                  onMarketing={(c) => set("marketingConsent", c)}
                />
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

/** One of the light family-business questions: a row of choices, any of which may stay unanswered. */
function FamilyQuestion(props: {
  id: string;
  label: string;
  value: string;
  choices: readonly string[];
  prefix: string;
  onChange: (v: string) => void;
  ltr?: boolean;
}) {
  const t = useTranslations("inquiry");
  return (
    <Field>
      <FieldLabel id={`${props.id}Label`}>{props.label}</FieldLabel>
      <ToggleGroup type="single" variant="outline" size="sm" aria-labelledby={`${props.id}Label`} value={props.value} onValueChange={props.onChange} className="flex-wrap">
        {props.choices.map((c) => (
          <ToggleGroupItem key={c} value={c} className="px-3">
            {props.ltr ? <bdi dir="ltr">{t(`${props.prefix}.${c}`)}</bdi> : t(`${props.prefix}.${c}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
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
                    "flex size-6 items-center justify-center rounded-full border bg-background text-xs tabular-nums transition-colors",
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
  onMarketing,
}: {
  answers: Answers;
  options: InquiryOptions;
  onEdit: (step: number) => void;
  errors: Record<string, string>;
  onConsent: (c: boolean) => void;
  onMarketing: (c: boolean) => void;
}) {
  const t = useTranslations("inquiry");
  const label = (list: Choice[], code: string) => list.find((c) => c.code === code)?.label ?? code;
  const none = <span className="text-muted-foreground">{t("review.notAnswered")}</span>;
  const answered = SELF_CHECKS.filter((k) => a.selfCheck[k] !== undefined);
  const family = FAMILY_OWNERSHIP.includes(a.ownershipType);
  const familyAnswers = [
    a.familyGeneration ? t(`family.generations.${a.familyGeneration}`) : null,
    a.familyWorking ? t("family.workingShort", { band: t(`family.workingBands.${a.familyWorking}`) }) : null,
    a.familyGovernance ? t(`family.governances.${a.familyGovernance}`) : null,
  ].filter(Boolean);
  const sections: { step: number; rows: [string, React.ReactNode][] }[] = [
    {
      step: 0,
      rows: [
        [t("org.name"), [a.orgName, a.orgNameAr].filter(Boolean).join(" · ")],
        [t("org.sector"), label(options.sectors, a.sector)],
      ],
    },
    {
      step: 1,
      rows: [
        [t("contact.name"), [a.contactName, a.requesterRole ? t(`requesterRole.${a.requesterRole}`) : null, a.contactRole].filter(Boolean).join(" · ")],
        [t("contact.email"), <bdi key="e">{a.email}</bdi>],
        [t("contact.phone"), a.phone ? <bdi key="p">{a.phone}</bdi> : none],
        [t("contact.channel"), t(`channel.${a.contactChannel}`)],
      ],
    },
    {
      step: 2,
      rows: [
        [t("needs.services"), a.services.map((s) => label(options.services, s)).join("، ")],
        [t("review.whyNow"), <span key="w" dir="auto" className="whitespace-pre-wrap">{a.whyNow}</span>],
        [t("needs.urgency"), a.urgency ? t(`urgency.${a.urgency}`) : none],
      ],
    },
    {
      step: 3,
      rows: [
        [t("org.ownership"), a.ownershipType ? t(`ownershipType.${a.ownershipType}`) : none],
        [t("org.size"), a.employeeBand ? <bdi key="b" dir="ltr">{t(`employeeBand.${a.employeeBand}`)}</bdi> : none],
        ...(family ? [[t("family.title"), familyAnswers.length ? familyAnswers.join("، ") : none] as [string, React.ReactNode]] : []),
        [
          t("today.title"),
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
      {/* Separate from the consent above and never ticked for them (PDPL). */}
      <Field orientation="horizontal">
        <Checkbox id="marketingConsent" checked={a.marketingConsent} onCheckedChange={(c) => onMarketing(c === true)} />
        <FieldContent>
          <FieldLabel htmlFor="marketingConsent" className="font-normal leading-relaxed">
            {t("review.marketing")}
          </FieldLabel>
          <FieldDescription>{t("review.marketingHint")}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}

function Sent({ refCode, email, onAgain }: { refCode: string; email: string; onAgain: () => void }) {
  const t = useTranslations("inquiry");
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
          <CopyButton content={refCode} label={t("sent.copy")} onCopied={() => toast.success(t("sent.copied"))} />
        </div>
        <p className="text-xs text-muted-foreground">{t("sent.refHint")}</p>
      </CardContent>
      <Button type="button" variant="outline" onClick={onAgain}>
        {t("sent.another")}
      </Button>
    </Card>
  );
}
