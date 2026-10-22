"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface Settings {
  intakeEmail: string | null;
  suggestionsEnabled: boolean;
  clientKpisEnabled: boolean;
  kpiGraceDays: number;
  staleDays: number;
  checkinDays: number[];
  accessReviewDays: number;
  restrictedMaxAdmins: number;
  minimalPurgeDays: number;
  transcriptKeepDays: number;
  chatArchiveDays: number;
  chatAfterCloseDays: number;
  chatIdleDeleteDays: number;
}
type Key = keyof Settings;

/** One card, one save: only the card's own fields are sent. */
function Section(props: { id: string; title: string; description: string; children: ReactNode; send: () => Promise<boolean> }) {
  const t = useTranslations("common");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const ok = await props.send();
    setBusy(false);
    if (ok) toast.success(t("saved"));
  }
  return (
    <Card id={props.id} className="gap-4 py-5 shadow-xs">
      <form onSubmit={submit} className="contents">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-5">{props.children}</CardContent>
        <CardFooter className="justify-end px-5">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function Row({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function FirmSettingsForm({ initial }: { initial: Settings }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [checkins, setCheckins] = useState(initial.checkinDays.join(", "));
  const [error, setError] = useState<Partial<Record<string, string>>>({});
  const set = <K extends Key>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  const save =
    (section: string, keys: Key[], extra: Partial<Settings> = {}) =>
    async () => {
      const body = { ...Object.fromEntries(keys.map((k) => [k, s[k]])), ...extra };
      const r = await callApi("/api/firm/settings", "PATCH", body);
      if (!r.ok) {
        setError((e) => ({ ...e, [section]: r.message ?? tc(`errors.${r.error}`) }));
        return false;
      }
      setError((e) => ({ ...e, [section]: undefined }));
      const next = (r.data as { settings: Settings }).settings;
      setS(next);
      setCheckins(next.checkinDays.join(", "));
      router.refresh();
      return true;
    };

  const days = (k: Key, id: string, min: number, max: number) => (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        required
        className="w-24 tabular-nums"
        dir="ltr"
        value={String(s[k])}
        onChange={(e) => set(k, Number(e.target.value) as never)}
      />
      <span className="text-sm text-muted-foreground">{t("days")}</span>
    </div>
  );
  const err = (section: string) =>
    error[section] ? (
      <p role="alert" className="text-sm text-destructive">
        {error[section]}
      </p>
    ) : null;

  return (
    <div className="grid gap-6">
      <Section
        id="intake"
        title={t("intake.title")}
        description={t("intake.hint")}
        send={save("intake", ["intakeEmail", "suggestionsEnabled"])}
      >
        <div className="grid gap-2">
          <Label htmlFor="s-intake">{t("intake.email")}</Label>
          <Input
            id="s-intake"
            type="email"
            maxLength={254}
            dir="ltr"
            className="max-w-sm"
            placeholder="inquiries@firm.example"
            value={s.intakeEmail ?? ""}
            onChange={(e) => set("intakeEmail", e.target.value)}
          />
          <p className="text-sm text-muted-foreground">{t("intake.emailHint")}</p>
        </div>
        <Row id="s-suggest" label={t("intake.suggestions")} hint={t("intake.suggestionsHint")}>
          <Switch id="s-suggest" checked={s.suggestionsEnabled} onCheckedChange={(v) => set("suggestionsEnabled", v)} />
        </Row>
        {err("intake")}
      </Section>

      <Section
        id="kpis"
        title={t("kpis.title")}
        description={t("kpis.hint")}
        send={save("kpis", ["clientKpisEnabled", "kpiGraceDays"])}
      >
        <Row id="s-kpis" label={t("kpis.enabled")} hint={t("kpis.enabledHint")}>
          <Switch id="s-kpis" checked={s.clientKpisEnabled} onCheckedChange={(v) => set("clientKpisEnabled", v)} />
        </Row>
        <Row id="s-grace" label={t("kpis.grace")} hint={t("kpis.graceHint")}>
          {days("kpiGraceDays", "s-grace", 0, 90)}
        </Row>
        {err("kpis")}
      </Section>

      <Section
        id="follow-through"
        title={t("follow.title")}
        description={t("follow.hint")}
        send={async () => {
          const list = checkins
            .split(/[,\s،]+/)
            .filter(Boolean)
            .map(Number);
          if (list.some((n) => !Number.isInteger(n) || n < 1 || n > 730) || list.length > 6) {
            setError((e) => ({ ...e, follow: t("follow.checkinsInvalid") }));
            return false;
          }
          return save("follow", ["staleDays"], { checkinDays: list })();
        }}
      >
        <Row id="s-stale" label={t("follow.stale")} hint={t("follow.staleHint")}>
          {days("staleDays", "s-stale", 1, 365)}
        </Row>
        <Row id="s-checkins" label={t("follow.checkins")} hint={t("follow.checkinsHint")}>
          <Input
            id="s-checkins"
            dir="ltr"
            className="w-40 tabular-nums"
            placeholder="30, 60, 90"
            value={checkins}
            onChange={(e) => setCheckins(e.target.value)}
          />
        </Row>
        {err("follow")}
      </Section>

      <Section
        id="accounts"
        title={t("accounts.title")}
        description={t("accounts.hint")}
        send={save("accounts", ["accessReviewDays", "restrictedMaxAdmins"])}
      >
        <Row id="s-review" label={t("accounts.review")} hint={t("accounts.reviewHint")}>
          {days("accessReviewDays", "s-review", 7, 365)}
        </Row>
        <Row id="s-admins" label={t("accounts.restricted")} hint={t("accounts.restrictedHint")}>
          <Input
            id="s-admins"
            type="number"
            min={1}
            max={10}
            required
            className="w-24 tabular-nums"
            dir="ltr"
            value={String(s.restrictedMaxAdmins)}
            onChange={(e) => set("restrictedMaxAdmins", Number(e.target.value))}
          />
        </Row>
        <p className="text-sm text-muted-foreground">
          {t("accounts.domains")}{" "}
          <Link href="/team" className="font-medium text-foreground underline underline-offset-4">
            {t("accounts.domainsLink")}
          </Link>
        </p>
        {err("accounts")}
      </Section>

      <Section
        id="records"
        title={t("records.title")}
        description={t("records.hint")}
        send={save("records", ["minimalPurgeDays", "transcriptKeepDays"])}
      >
        <Row id="s-purge" label={t("records.purge")} hint={t("records.purgeHint")}>
          {days("minimalPurgeDays", "s-purge", 0, 3650)}
        </Row>
        <Row id="s-transcripts" label={t("records.transcripts")} hint={t("records.transcriptsHint")}>
          {days("transcriptKeepDays", "s-transcripts", 1, 90)}
        </Row>
        {err("records")}
      </Section>

      <Section
        id="chats"
        title={t("chats.title")}
        description={t("chats.hint")}
        send={save("chats", ["chatArchiveDays", "chatAfterCloseDays", "chatIdleDeleteDays"])}
      >
        <Row id="s-chat-archive" label={t("chats.archive")} hint={t("chats.archiveHint")}>
          {days("chatArchiveDays", "s-chat-archive", 7, 365)}
        </Row>
        <Row id="s-chat-close" label={t("chats.afterClose")} hint={t("chats.afterCloseHint")}>
          {days("chatAfterCloseDays", "s-chat-close", 0, 365)}
        </Row>
        <Row id="s-chat-idle" label={t("chats.idle")} hint={t("chats.idleHint")}>
          {days("chatIdleDeleteDays", "s-chat-idle", 30, 730)}
        </Row>
        {err("chats")}
      </Section>
    </div>
  );
}
