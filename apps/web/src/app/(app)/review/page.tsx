import { ActionsTabs } from "@/components/actions-tabs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { EmptyState } from "@/components/empty-state";
import { MorphTitle } from "@/components/morph";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { reviewQueue } from "@/services/second-review";

/** Work waiting for the firm's decision, oldest first, with how long it has waited and how far a two-person sign-off has got (F22). */
export default async function ReviewPage() {
  const rows = await withPrincipal(async (tx, principal) => (principal.orgKind === "firm" ? reviewQueue(tx, principal) : null));
  if (!rows) notFound();
  const [t, tTable, tNav, format] = await Promise.all([getTranslations("reviewPage"), getTranslations("table"), getTranslations("nav"), getFormatter()]);
  const mine = rows.filter((r) => r.canAct).length;
  return (
    <>
      <ActionsTabs current="/review" label={tNav("actions")} labels={{ actions: tNav("actions"), review: tNav("reviewQueue"), oversight: tNav("oversight") }} />
      <PageHeader title={t("title")} description={t("subtitle")} />
      {rows.length === 0 ? (
        <EmptyState icon={<CircleCheck animateOnView />} description={t("empty")} />
      ) : (
        <>
          <p className="-mt-2 text-sm text-muted-foreground">{t("count", { n: rows.length, mine })}</p>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>{tTable("action")}</TableHead>
                  <TableHead className="hidden md:table-cell">{tTable("project")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{tTable("owner")}</TableHead>
                  <TableHead>{t("waiting")}</TableHead>
                  <TableHead>{t("stage")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{tTable("due")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-72">
                      <Link href={`/actions/${r.id}`} className="block truncate font-medium hover:underline">
                        <MorphTitle name={`action-${r.id}`} className="truncate">
                          {r.title}
                        </MorphTitle>
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{r.recommendationTitle}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Link href={`/projects/${r.projectId}`} className="text-primary hover:underline">
                        {r.projectTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{r.ownerName ?? tTable("unassigned")}</TableCell>
                    <TableCell className="tabular-nums" title={r.since ? format.dateTime(r.since, { dateStyle: "medium", timeStyle: "short" }) : undefined}>
                      {r.waitingDays === null ? "—" : t("days", { n: r.waitingDays })}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {r.required ? (
                          <ToneBadge tone={r.signedBy ? "active" : "waiting"}>{r.signedBy ? t("secondOfTwo") : t("firstOfTwo")}</ToneBadge>
                        ) : (
                          <ToneBadge tone="waiting">{t("oneReview")}</ToneBadge>
                        )}
                        {r.signedBy ? (
                          <span className="text-xs text-muted-foreground">{r.signedByMe ? t("youSigned") : t("signedBy", { name: r.signedBy })}</span>
                        ) : null}
                        {!r.canAct && !r.signedByMe ? <span className="text-xs text-muted-foreground">{t("notYours")}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className={cn("hidden tabular-nums sm:table-cell", r.overdue && "font-medium text-destructive")}>
                      {r.dueDate ? format.dateTime(new Date(r.dueDate), { dateStyle: "medium" }) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
