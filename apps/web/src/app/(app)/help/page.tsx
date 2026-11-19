import { BookOpen, Crown, Mail, UserCheck } from "lucide-react";
import Link from "next/link";
import { Users } from "@/components/animate-ui/icons/users";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { guideFor, guideHrefFor } from "@/lib/handbook";
import { FAQ_KEYS, helpConsultants } from "@/lib/help";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { getHelp } from "@/services/help";
import { ProblemForm } from "./problem-form";

/**
 * Help for the client's people (F13; page audit U17). Three things, the
 * same for every client role: who your consultants are and how to reach
 * them (a question about one action goes in that action's discussion,
 * anything else to their work address); a message to the firm's management,
 * for a problem with Selah or a concern you would rather not raise with your
 * consultant; and the common questions. It is not a home page: no first
 * steps and no list of your actions. Firm staff get a 404.
 */
export default async function HelpPage() {
  const { help, role } = await withPrincipal(async (tx, principal) => ({ help: await getHelp(tx, principal), role: principal.role }));
  const [t, format, locale] = await Promise.all([getTranslations("help"), getFormatter(), getLocale()]);
  const ar = locale === "ar";
  // The reader's own part of the handbook (the client guide), once it is written (big prompt 6.2).
  const guide = guideFor(role, locale);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const people = helpConsultants(help);
  const firm = help.firm ? localName(help.firm, ar) : null;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        {guide ? (
          <Link href={guideHrefFor(role)} data-slot="button" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <BookOpen />
            {t("guide.open")}
          </Link>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("consultants.title")}</CardTitle>
            <CardDescription>{t("consultants.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            {help.readOnly ? <p className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">{t("consultants.readOnly")}</p> : null}
            {people.length ? (
              <ul className="divide-y">
                {people.map((p) => (
                  <li key={p.userId} className="space-y-1 py-3 first:pt-0 last:pb-0">
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
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.isLead ? t("consultants.leadHint") : p.isDeputy ? t("consultants.deputyHint") : null,
                        p.projects.length ? t("consultants.onProjects", { projects: p.projects.join(ar ? "، " : ", ") }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <a
                      href={`mailto:${p.email}`}
                      className="flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
                      title={t("consultants.mail", { name: p.name })}
                    >
                      <Mail className="size-3.5 shrink-0" />
                      <bdi dir="ltr">{p.email}</bdi>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Users animateOnView />} description={t(help.projects.length ? "consultants.noLead" : "consultants.noProjects")} />
            )}
            {people.length && !help.lead ? <p className="text-xs text-muted-foreground">{t("consultants.noLead")}</p> : null}
          </CardContent>
        </Card>

        <Card className="h-fit gap-4 py-5 shadow-xs">
          <CardHeader className="px-5">
            <CardTitle className="text-base">{t("problem.title")}</CardTitle>
            <CardDescription>{firm ? t("problem.leadNamed", { firm }) : t("problem.lead")}</CardDescription>
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

      <Card className="gap-2 py-5 shadow-xs">
        <CardHeader className="px-5">
          <CardTitle className="text-base">{t("faq.title")}</CardTitle>
        </CardHeader>
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
