import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { withPrincipal } from "@/server/page";
import { listInquiries } from "@/services/inquiries";
import { intakeOptions } from "@/services/intake";
import { ToneBadge } from "@/components/tone-badge";

const CLOSED = new Set(["lost", "declined", "spam", "withdrawn"]);
const VIEWS = ["open", "won", "closed"] as const;
type View = (typeof VIEWS)[number];
const inView = (status: string, view: View) =>
  view === "won" ? status === "won" : view === "closed" ? CLOSED.has(status) : status !== "won" && !CLOSED.has(status);

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: asked } = await searchParams;
  const view: View = VIEWS.includes(asked as View) ? (asked as View) : "open";
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    return { rows: await listInquiries(tx, principal), options: await intakeOptions(tx), admin: principal.role === "firm_admin" };
  });
  if (!data) notFound();
  const [t, ti, format] = await Promise.all([getTranslations("inbox"), getTranslations("inquiry"), getFormatter()]);
  const ar = (await getLocale()) === "ar";
  const label = (list: { code: string; nameAr: string; nameEn: string }[], code: string) => {
    const x = list.find((o) => o.code === code);
    return x ? (ar ? x.nameAr : x.nameEn) : code;
  };
  const rows = data.rows.filter((r) => inView(r.status, view));

  return (
    <>
      <PageHeader title={t("title")} description={data.admin ? t("description") : t("descriptionConsultant")} />
      <nav className="flex gap-1 rounded-lg bg-muted p-1 text-sm w-fit">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "open" ? "/inquiries" : `/inquiries?view=${v}`}
            className={cn(
              "rounded-md px-3 py-1",
              v === view ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`views.${v}`)}{" "}
            <span className="tabular-nums text-muted-foreground">{data.rows.filter((r) => inView(r.status, v)).length}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("org")}</TableHead>
                <TableHead>{t("services")}</TableHead>
                <TableHead>{t("urgency")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead>{t("conflict")}</TableHead>
                <TableHead className="text-end">{t("received")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/inquiries/${r.id}`} className="font-medium hover:underline">
                      {(ar ? r.orgNameAr : null) ?? r.orgName ?? r.publicRef}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {label(data.options.sectors, r.sector)} · {ti(`employeeBand.${r.employeeBand}`)} ·{" "}
                      <span dir="ltr">{r.publicRef}</span>
                    </p>
                  </TableCell>
                  <TableCell className="max-w-64 text-sm whitespace-normal">
                    {r.services.map((c) => label(data.options.services, c)).join(ar ? "، " : ", ")}
                  </TableCell>
                  <TableCell className="text-sm">{r.urgency ? ti(`urgency.${r.urgency}`) : "—"}</TableCell>
                  <TableCell>
                    <ToneBadge tone={r.status === "new" ? "new" : "open"}>{t(`statuses.${r.status}`)}</ToneBadge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.ownerName ?? <span className="text-muted-foreground">{t("unassigned")}</span>}
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone={r.conflictStatus === "flagged" ? "problem" : "neutral"}>
                      {t(`conflicts.${r.conflictStatus}`)}
                    </ToneBadge>
                  </TableCell>
                  <TableCell className="text-end text-sm text-muted-foreground tabular-nums">
                    {format.dateTime(r.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
