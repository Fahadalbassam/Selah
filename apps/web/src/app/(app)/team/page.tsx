import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { authorize } from "@/authz";
import { firmSettings } from "@/db/schema";
import { firmToday } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withPrincipal } from "@/server/page";
import { listPeople } from "@/services/accounts";
import { teamMetrics } from "@/services/follow-through";
import { teamLoad, type TeamLoad } from "@/services/team-load";
import { Badge } from "@/components/ui/badge";
import { listTeam } from "@/services/queries";
import { StatTile } from "@/components/stat-tile";
import { EmptyState } from "@/components/empty-state";
import { Users } from "@/components/animate-ui/icons/users";
import { PeopleAdmin } from "./people-admin";
import { SectionHeader } from "@/components/section-header";

export default async function TeamPage() {
  const data = await withPrincipal(async (tx, principal) => {
    const since = new Date(`${firmToday()}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 90);
    // Who may not read the team list gets not-found, like every other blocked page (review L09).
    const readable = authorize(principal, "org_user.read", {
      type: "org_user",
      orgId: principal.orgId,
      firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
      projectId: null,
    }).allowed;
    if (!readable) return null;
    const admin = principal.role === "firm_admin" || principal.role === "client_admin";
    const [settings] =
      principal.orgKind === "firm"
        ? await tx
            .select({ days: firmSettings.accessReviewDays })
            .from(firmSettings)
            .where(eq(firmSettings.orgId, principal.orgId))
        : [];
    return {
      // Admins manage their organisation's accounts here; everyone else sees the list.
      people: admin ? await listPeople(tx, principal, principal.orgId) : null,
      team: admin ? [] : await listTeam(tx, principal),
      // The firm admin's staffing view; everyone else gets nothing.
      load: await teamMetrics(tx, principal, since.toISOString().slice(0, 10)).catch(() => null),
      queue: principal.role === "firm_admin" ? await teamLoad(tx, principal).catch(() => null) : null,
      me: principal.userId,
      role: principal.role,
      reviewDays: settings?.days ?? (principal.orgKind === "firm" ? 90 : null),
    };
  });
  if (!data) notFound();
  const { team, people, load, queue, me, role, reviewDays } = data;
  const [t, tRole] = await Promise.all([getTranslations("team"), getTranslations("role")]);
  return (
    <>
      <PageHeader title={t("title")} />
      {people ? (
        <PeopleAdmin data={people} me={me} myRole={role} reviewDays={reviewDays} />
      ) : team.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("email")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead className="text-end">{t("projects")}</TableHead>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {load && queue ? <Workload load={load} queue={queue} /> : null}
    </>
  );
}

type Load = Awaited<ReturnType<typeof teamMetrics>>;

/**
 * Each colleague's load, by name, and the team's totals. No per-person score.
 * The review columns count what this person could review (not their own
 * work, not what they submitted or already signed); the due columns count
 * open work on the projects they work on (services/team-load.ts).
 */
async function Workload({ load, queue }: { load: Load; queue: TeamLoad }) {
  const [t, tTeam, tRole] = await Promise.all([getTranslations("metrics"), getTranslations("team"), getTranslations("role")]);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const median = n(load.totals?.median_review_days);
  const rows = load.workload as {
    user_id: string;
    name: string;
    role: Parameters<typeof tRole>[0];
    clients: number;
    projects: number;
  }[];
  return (
    <section className="space-y-4 pt-4">
      <SectionHeader title={t("totals")} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("reviewsDone")} value={n(load.totals?.reviews) ?? 0} />
        <StatTile label={t("medianReview")} value={median === null ? "—" : t("days", { n: median })} />
        <StatTile label={t("waiting")} value={n(load.totals?.awaiting_review) ?? 0} />
        <StatTile label={t("overdue")} value={n(load.totals?.overdue) ?? 0} hint={t("overdueHint")} />
      </div>
      <div className="pt-2">
        <SectionHeader title={t("team")} description={t("teamHint")} />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{tTeam("name")}</TableHead>
              <TableHead>{tTeam("role")}</TableHead>
              <TableHead className="text-end">{t("clients")}</TableHead>
              <TableHead className="text-end">{t("openProjects")}</TableHead>
              <TableHead className="text-end">{t("toReview")}</TableHead>
              <TableHead className="text-end">{t("oldestWait")}</TableHead>
              <TableHead className="text-end">{t("secondSignOffs")}</TableHead>
              <TableHead className="text-end">{t("overdue")}</TableHead>
              <TableHead className="text-end">{t("due7")}</TableHead>
              <TableHead className="text-end">{t("due30")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const q = queue.get(r.user_id);
              const num = (v: number | undefined) => (v ? v : <span className="text-muted-foreground">0</span>);
              return (
                <TableRow key={r.user_id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {r.name}
                      {q && !q.accepting ? <Badge variant="outline">{t("notAccepting")}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>{tRole(r.role)}</TableCell>
                  <TableCell className="text-end tabular-nums">{r.clients}</TableCell>
                  <TableCell className="text-end tabular-nums">{r.projects}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(q?.backlog)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {q?.oldestDays == null ? <span className="text-muted-foreground">—</span> : t("days", { n: q.oldestDays })}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{num(q?.second)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(q?.overdue)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(q?.due7)}</TableCell>
                  <TableCell className="text-end tabular-nums">{num(q?.due30)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
