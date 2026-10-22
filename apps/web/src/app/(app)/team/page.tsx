import { getTranslations } from "next-intl/server";
import { firmToday } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withPrincipal } from "@/server/page";
import { teamMetrics } from "@/services/follow-through";
import { listTeam } from "@/services/queries";
import { StatTile } from "@/components/stat-tile";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";

export default async function TeamPage() {
  const { team, load } = await withPrincipal(async (tx, principal) => {
    const since = new Date(`${firmToday()}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 90);
    return {
      team: await listTeam(tx, principal),
      // The firm admin's staffing view; everyone else gets nothing.
      load: await teamMetrics(tx, principal, since.toISOString().slice(0, 10)).catch(() => null),
    };
  });
  const [t, tRole] = await Promise.all([getTranslations("team"), getTranslations("role")]);
  const showTwoFactor = team.some((m) => m.twoFactor !== null);
  return (
    <>
      <PageHeader title={t("title")} />
      {team.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("email")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead className="text-end">{t("projects")}</TableHead>
                {showTwoFactor ? <TableHead>{t("twoFactor")}</TableHead> : null}
                {showTwoFactor ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell" dir="ltr">
                    {m.email}
                  </TableCell>
                  <TableCell>{tRole(m.role)}</TableCell>
                  <TableCell className="text-end tabular-nums">{m.projectCount}</TableCell>
                  {showTwoFactor ? (
                    <TableCell>
                      <Badge variant={m.twoFactor ? "secondary" : "outline"}>
                        {m.twoFactor ? t("twoFactorOn") : t("twoFactorOff")}
                      </Badge>
                    </TableCell>
                  ) : null}
                  {showTwoFactor ? (
                    <TableCell className="text-end">
                      {m.canResetTwoFactor ? (
                        <FormDialog
                          trigger={
                            <Button variant="ghost" size="sm">
                              {t("resetTwoFactor")}
                            </Button>
                          }
                          title={t("resetTwoFactorTitle", { name: m.name })}
                          description={t("resetTwoFactorHint")}
                          endpoint={`/api/people/${m.id}/two-factor-reset`}
                          fields={[{ name: "reason", label: t("reason"), type: "textarea", required: true, maxLength: 500 }]}
                          submitLabel={t("resetTwoFactor")}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {load ? <Workload load={load} /> : null}
    </>
  );
}

type Load = Awaited<ReturnType<typeof teamMetrics>>;

/** Each colleague's load, by name, and the team's totals. No per-person score. */
async function Workload({ load }: { load: Load }) {
  const [t, tTeam, tRole] = await Promise.all([getTranslations("metrics"), getTranslations("team"), getTranslations("role")]);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const median = n(load.totals?.median_review_days);
  const rows = load.workload as {
    user_id: string;
    name: string;
    role: Parameters<typeof tRole>[0];
    clients: number;
    projects: number;
    open_reviews: number;
  }[];
  return (
    <section className="space-y-4 pt-4">
      <h2 className="text-lg font-semibold">{t("totals")}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("reviewsDone")} value={n(load.totals?.reviews) ?? 0} />
        <StatTile label={t("medianReview")} value={median === null ? "—" : t("days", { n: median })} />
        <StatTile label={t("waiting")} value={n(load.totals?.awaiting_review) ?? 0} />
        <StatTile label={t("overdue")} value={n(load.totals?.overdue) ?? 0} hint={t("overdueHint")} />
      </div>
      <div className="space-y-1 pt-2">
        <h2 className="text-lg font-semibold">{t("team")}</h2>
        <p className="text-sm text-muted-foreground">{t("teamHint")}</p>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tTeam("name")}</TableHead>
              <TableHead>{tTeam("role")}</TableHead>
              <TableHead className="text-end">{t("clients")}</TableHead>
              <TableHead className="text-end">{t("openProjects")}</TableHead>
              <TableHead className="text-end">{t("waiting")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{tRole(r.role)}</TableCell>
                <TableCell className="text-end tabular-nums">{r.clients}</TableCell>
                <TableCell className="text-end tabular-nums">{r.projects}</TableCell>
                <TableCell className="text-end tabular-nums">{r.open_reviews}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
