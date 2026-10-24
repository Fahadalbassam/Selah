"use client";

import { BellOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Bell } from "@/components/animate-ui/icons/bell";
import { BrandLoader } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FIRM_TIME_ZONE } from "@/lib/dates";
import { MAIL_CADENCES, REMINDER_CADENCES, type MailCadence, type MailChoices } from "@/lib/mail-choices";

/** Every half hour of the day, as HH:MM. */
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** A time of day in half-hour steps (firm time), shown in the reader's own clock format. */
/** `labelledBy`: ids of the visible words that name this time (the trigger itself only shows the time). */
export function TimeSelect(props: { id: string; value: string; onChange: (v: string) => void; className?: string; labelledBy?: string }) {
  const format = useFormatter();
  const label = (t: string) => {
    const [h = 0, m = 0] = t.split(":").map(Number);
    return format.dateTime(new Date(Date.UTC(2000, 0, 1, h, m)), { timeStyle: "short", timeZone: "UTC" });
  };
  const options = TIMES.includes(props.value) ? TIMES : [...TIMES, props.value].sort();
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger
        id={props.id}
        aria-labelledby={props.labelledBy ? `${props.labelledBy} ${props.id}` : undefined}
        className={props.className ?? "w-32 tabular-nums"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((t) => (
          <SelectItem key={t} value={t} className="tabular-nums">
            {label(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="max-w-lg space-y-1">
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {/* Radix's hidden form input beside a switch shifts the page sideways in RTL; keep it in this box. */}
      <div className="relative flex shrink-0 items-center gap-2 [&>input]:!start-0 [&>input]:![transform:none]">{children}</div>
    </div>
  );
}

export interface MailChoicesView extends MailChoices {
  nextMailAt: string | null;
  firmRamadan: { starts: string; ends: string; mailFrom: string; mailTo: string } | null;
}

/** The caller's own mail choices: how often, quiet hours, the Saudi week and Ramadan. */
export function MailChoicesForm({ initial }: { initial: MailChoicesView }) {
  const t = useTranslations("notifications.mail");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [s, setS] = useState<MailChoices>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MailChoices>(k: K, v: MailChoices[K]) => setS((x) => ({ ...x, [k]: v }));
  const quiet = s.quietFrom !== null;
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const clock = (hm: string) => {
    const [h = 0, m = 0] = hm.split(":").map(Number);
    return format.dateTime(new Date(Date.UTC(2000, 0, 1, h, m)), { timeStyle: "short", timeZone: "UTC" });
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const r = await callApi("/api/notifications/mail", "PUT", s);
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    setError(null);
    toast.success(tc("saved"));
    router.refresh();
  }

  const cadence = (id: string, key: "updates" | "reminders", choices: readonly MailCadence[]) => (
    <Select value={s[key]} onValueChange={(v) => set(key, v as MailCadence)}>
      <SelectTrigger id={id} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c} value={c}>
            {t(`cadence.${c}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <form onSubmit={submit} className="contents">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("hint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-5">
          <Row id="m-updates" label={t("updates")} hint={t("updatesHint")}>
            {cadence("m-updates", "updates", MAIL_CADENCES)}
          </Row>
          <Row id="m-reminders" label={t("reminders")} hint={t("remindersHint")}>
            {cadence("m-reminders", "reminders", REMINDER_CADENCES)}
          </Row>
          <Row id="m-quiet" label={t("quiet")} hint={t("quietHint")}>
            {quiet ? (
              <>
                <TimeSelect id="m-quiet-from" labelledBy="m-quiet-label" value={s.quietFrom!} onChange={(v) => set("quietFrom", v)} />
                <span id="m-quiet-to-label" className="text-sm text-muted-foreground">
                  {t("to")}
                </span>
                <TimeSelect id="m-quiet-to" labelledBy="m-quiet-to-label" value={s.quietTo!} onChange={(v) => set("quietTo", v)} />
              </>
            ) : null}
            <span className="relative [&>input]:!start-0 [&>input]:![transform:none]">
              <Switch
                id="m-quiet"
                aria-label={t("quiet")}
                checked={quiet}
                onCheckedChange={(on) => setS((x) => ({ ...x, quietFrom: on ? "20:00" : null, quietTo: on ? "07:00" : null }))}
              />
            </span>
          </Row>
          <Row id="m-saturday" label={t("saturday")} hint={t("saturdayHint")}>
            <Switch id="m-saturday" checked={s.saturday} onCheckedChange={(v) => set("saturday", v)} />
          </Row>
          <Row
            id="m-ramadan"
            label={t("ramadan")}
            hint={
              initial.firmRamadan
                ? t("ramadanHint", {
                    starts: day(initial.firmRamadan.starts),
                    ends: day(initial.firmRamadan.ends),
                    from: clock(initial.firmRamadan.mailFrom),
                    to: clock(initial.firmRamadan.mailTo),
                  })
                : t("ramadanUnset")
            }
          >
            <Switch id="m-ramadan" checked={s.ramadan} onCheckedChange={(v) => set("ramadan", v)} />
          </Row>
          <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
            {t("always")}
            {initial.nextMailAt ? (
              <>
                {" "}
                {t("next", { when: format.dateTime(new Date(initial.nextMailAt), { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: FIRM_TIME_ZONE }) })}
              </>
            ) : null}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end px-5">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {tc("save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/** The actions the caller muted, each with a way back. */
export function MutedActions({ items }: { items: { actionId: string; title: string }[] }) {
  const t = useTranslations("notifications.mail");
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("muted")}</CardTitle>
        <CardDescription>{t("mutedHint")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {items.length === 0 ? (
          <EmptyState icon={<Bell animateOnView className="size-5" />} description={t("mutedNone")} className="py-6 md:py-6" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((m) => (
              <li key={m.actionId} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <Link href={`/actions/${m.actionId}`} className="truncate text-sm font-medium hover:underline">
                  {m.title}
                </Link>
                <MuteButton actionId={m.actionId} muted />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Mute or unmute mail about one action. In-app notices keep coming either way. */
export function MuteButton({ actionId, muted }: { actionId: string; muted: boolean }) {
  const t = useTranslations("notifications.mail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const r = await callApi(`/api/actions/${actionId}/mute`, "PUT", { muted: !muted });
    setBusy(false);
    if (!r.ok) return toast.error(tc(`errors.${r.error}`));
    toast.success(muted ? t("unmuted") : t("mutedDone"));
    router.refresh();
  }
  return (
    <Button type="button" variant={muted ? "ghost" : "outline"} size="sm" disabled={busy} onClick={toggle}>
      {busy ? <BrandLoader tone="current" className="size-4" /> : <BellOff />}
      {muted ? t("unmute") : t("mute")}
    </Button>
  );
}
