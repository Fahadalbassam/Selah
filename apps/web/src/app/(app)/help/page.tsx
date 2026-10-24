import { Crown, Mail, UserCheck } from "lucide-react";
import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { Users } from "@/components/animate-ui/icons/users";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionsTable } from "@/components/actions-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FAQ_KEYS } from "@/lib/help";
import { withPrincipal } from "@/server/page";
import { getHelp } from "@/services/help";
import { ProblemForm } from "./problem-form";

// Where each first step leads, per role (F13). The words are in messages: help.steps.<set>.
const STEPS = {
  client_admin: ["/team", "/projects", "/"],
  client_admin_restricted: ["/projects", null, "/"],
  client_manager: ["/", "/actions", "/actions"],
  action_owner: ["/actions", "/actions", "/actions"],
} as const;

interface Person {
  userId: string;
  name: string;
  email: string;
  isLead: boolean;
  isDeputy: boolean;
}

/**
 * Help for the client's people (F13): their first steps, the two doors (a
 * question about the work goes in the action's thread; a technical problem
 * goes to the firm's admins), who their consultants are, and the questions
 * people ask. Firm staff get a 404.
 */
export default async function HelpPage() {
  const { help, role } = await withPrincipal(async (tx, principal) => ({ help: await getHelp(tx, principal), role: principal.role }));
  const [t, tRole, tNav, format] = await Promise.all([getTranslations("help"), getTranslations("role"), getTranslations("nav"), getFormatter()]);
  const set = role === "client_admin" ? (help.engagementMode === "restricted" ? "client_admin_restricted" : "client_admin") : role === "client_manager" ? "client_manager" : "action_owner";
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  const personRow = (p: Person, label?: string) => (
    <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {p.name}
          {p.isLead ? (
            <Badge variant="outline" className="gap-1 border-transparent bg-accent text-accent-foreground">
              <Crown className="size-3" />
              {t("consultants.lead")}
            </Badge>
          ) : p.isDeputy ? (
            <Badge variant="outline" className="gap-1">
              <UserCheck className="size-3" />
              {t("consultants.deputy")}
            </Badge>
          ) : null}
        </p>
        {label ? <p className="text-xs text-muted-foreground">{label}</p> : null}
      </div>
      <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline" title={t("consultants.mail", { name: p.name })}>
        <Mail className="size-3.5 shrink-0" />
        <bdi dir="ltr">{p.email}</bdi>
      </a>
    </li>
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <Card className="gap-4 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("steps.title")}</CardTitle>
          <CardDescription>{t("steps.description", { role: tRole(role) })}</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS[set].map((href, i) => (
              <li key={i} className="flex gap-3 rounded-lg border p-4">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{t(`steps.${set}.${i}.title`)}</p>
                  <p className="text-sm text-muted-foreground">{t(`steps.${set}.${i}.body`)}</p>
                  {href ? (
                    <Link href={href} className="inline-block pt-1 text-sm text-primary hover:underline">
                      {t(`steps.${set}.${i}.link`)}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" />
              {t("ask.title")}
            </CardTitle>
            <CardDescription>{t("ask.lead")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 text-sm">
            <p>{t("ask.body")}</p>
            {help.readOnly ? <p className="rounded-lg bg-muted px-4 py-2 text-muted-foreground">{t("ask.readOnly")}</p> : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/actions">{role === "action_owner" ? tNav("myActions") : tNav("actions")}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("problem.title")}</CardTitle>
            <CardDescription>{t("problem.lead")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            {help.can.report ? <ProblemForm /> : <p className="text-sm text-muted-foreground">{t("problem.cannot")}</p>}
            {help.reports.length ? (
              <div className="space-y-2 border-t pt-4">
                <p className="text-xs font-medium text-muted-foreground">{t("problem.yours")}</p>
                <ul className="space-y-3">
                  {help.reports.map((r) => (
                    <li key={r.id} className="space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">{when(r.createdAt)}</span>
                        <ToneBadge tone={r.handledAt ? "neutral" : "waiting"}>{r.handledAt ? t("problem.handled") : t("problem.waiting")}</ToneBadge>
                      </div>
                      <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground" dir="auto">
                        {r.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <SectionHeader title={t("ask.openTitle")} description={t("ask.openHint")} />
      <ActionsTable rows={help.openActions} empty={t("ask.none")} />

      <SectionHeader title={t("consultants.title")} description={t("consultants.description")} />
      <Card className="gap-0 py-2 shadow-xs">
        <CardContent className="px-5">
          {help.lead || help.deputy ? (
            <ul className="divide-y">
              {help.lead ? personRow(help.lead, t("consultants.leadHint")) : null}
              {help.deputy ? personRow(help.deputy, t("consultants.deputyHint")) : null}
            </ul>
          ) : (
            <p className="py-3 text-sm text-muted-foreground">{t("consultants.noLead")}</p>
          )}
        </CardContent>
      </Card>
      {help.projects.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {help.projects.map((p) => (
            <Card key={p.id} className="gap-2 py-4 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">
                  <Link href={`/projects/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                </CardTitle>
                <CardDescription>{t("consultants.onProject")}</CardDescription>
              </CardHeader>
              <CardContent className="px-5">
                {p.consultants.length ? (
                  <ul className="divide-y">{p.consultants.map((c) => personRow(c))}</ul>
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">{t("consultants.noneOnProject")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Users animateOnView />} description={t("consultants.noProjects")} />
      )}

      <SectionHeader title={t("faq.title")} />
      <Card className="py-2 shadow-xs">
        <CardContent className="px-5">
          <Accordion type="multiple">
            {FAQ_KEYS.map((k) => (
              <AccordionItem key={k} value={k}>
                <AccordionTrigger>{t(`faq.${k}.q`)}</AccordionTrigger>
                <AccordionContent className="max-w-3xl whitespace-pre-line text-muted-foreground">{t(`faq.${k}.a`)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </>
  );
}
