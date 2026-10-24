import { ArrowLeft, Circle, Mail, MinusCircle, NotebookPen, UserPlus } from "lucide-react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton, FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FIRM_TIME_ZONE } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { SELF_CHECKS } from "@/lib/intake";
import { localLabel, localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { getInquiry, suggestLeads } from "@/services/inquiries";
import { intakeOptions } from "@/services/intake";
import { listClients, listTeam } from "@/services/queries";
import { BookDiscovery, ConvertDialog } from "./inquiry-panels";

const CLOSED = ["lost", "declined", "spam", "withdrawn"] as const;
// The self-check keys as the database stores them.
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withPrincipal(async (tx, principal) => {
    if (principal.orgKind !== "firm") return null;
    const detail = await getInquiry(tx, principal, id);
    const admin = detail.can.decide;
    const team = admin ? (await listTeam(tx, principal)).filter((m) => m.active !== false) : [];
    return {
      ...detail,
      options: await intakeOptions(tx),
      leads: admin ? await suggestLeads(tx, principal, id) : null,
      team: team.map((m) => ({ id: m.id, name: m.name, role: m.role })),
      clients: admin ? (await listClients(tx, principal)).map((c) => ({ id: c.id, name: c.name })) : [],
    };
  });
  if (!data) notFound();
  const [t, ti, format] = await Promise.all([getTranslations("inbox"), getTranslations("inquiry"), getFormatter()]);
  const ar = (await getLocale()) === "ar";
  const { inquiry: q, can } = data;
  const label = (list: { code: string; nameAr: string; nameEn: string }[], code: string) => {
    const x = list.find((o) => o.code === code);
    return x ? localLabel(x, ar) : code;
  };
  const when = (d: Date | string) =>
    format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short", timeZone: FIRM_TIME_ZONE });
  const closed = (CLOSED as readonly string[]).includes(q.status);
  const status = (s: string | null) => (s ? t(`statuses.${s}`) : "—");
  const selfCheck = q.selfCheck as Record<string, boolean | undefined>;
  const nameOf = (userId: string | null | undefined) => data.team.find((m) => m.id === userId)?.name;

  const rows: [string, React.ReactNode][] = [
    [
      t("source"),
      [t(`sources.${q.source}`), q.sourceClient ? localName(q.sourceClient, ar) : null, q.enteredByName ? t("enteredBy", { name: q.enteredByName }) : null]
        .filter(Boolean)
        .join(" · "),
    ],
    ...(q.tenderNumber
      ? [
          [
            t("tender"),
            <span key="tn">
              <span dir="ltr">{q.tenderNumber}</span>
              {q.tenderClosesOn
                ? ` · ${t("tenderCloses", { date: format.dateTime(new Date(`${q.tenderClosesOn}T00:00:00`), { dateStyle: "medium" }) })}`
                : null}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    [t("contact"), [q.contactName, q.contactRole].filter(Boolean).join(" · ") || "—"],
    [
      "",
      <span key="c" className="flex flex-wrap gap-x-3" dir="ltr">
        {q.contactEmail ? (
          <a href={`mailto:${q.contactEmail}`} className="hover:underline">
            {q.contactEmail}
          </a>
        ) : null}
        {q.contactPhone ? <span>{q.contactPhone}</span> : null}
      </span>,
    ],
    [t("language"), t(`langs.${q.preferredLanguage === "ar" ? "ar" : "en"}`)],
    [t("sector"), label(data.options.sectors, q.sector)],
    [t("size"), q.employeeBand ? ti(`employeeBand.${q.employeeBand}`) : "—"],
    [t("ownership"), q.ownershipType ? ti(`ownershipType.${q.ownershipType}`) : "—"],
    ...(q.crNumber
      ? [
          [
            t("cr"),
            <span key="cr" dir="ltr">
              {q.crNumber}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    [t("services"), q.services.map((c) => label(data.options.services, c)).join(ar ? "، " : ", ")],
    [t("urgency"), q.urgency ? ti(`urgency.${q.urgency}`) : "—"],
    ...(q.heardFrom ? [[t("heardFrom"), ti(`heardFromOption.${q.heardFrom}`)] as [string, React.ReactNode]] : []),
  ];

  return (
    <>
      <Link href="/inquiries" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>
      <PageHeader
        title={(ar ? q.orgNameAr : null) ?? q.orgName ?? q.publicRef}
        description={`${q.publicRef} · ${t("received")} ${when(q.createdAt)}`}
        meta={<ToneBadge tone={q.status === "new" ? "new" : "open"}>{status(q.status)}</ToneBadge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {can.work && !q.clientOrgId ? (
            <Card className="gap-4 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("nextStep")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 px-5">
                {can.forward === "triaged" || can.forward === "proposal_sent" ? (
                  <ApiButton
                    endpoint={`/api/intake/inquiries/${q.id}`}
                    method="PATCH"
                    body={{ status: can.forward }}
                    label={t(`forward.${can.forward}`)}
                    variant="default"
                    size="default"
                  />
                ) : null}
                {["new", "triaged", "discovery_scheduled"].includes(q.status) ? <BookDiscovery inquiryId={q.id} /> : null}
                {can.decide && !closed ? (
                  <FormDialog
                    trigger={<Button variant="outline">{t("close")}</Button>}
                    title={t("close")}
                    description={t("closeHint")}
                    endpoint={`/api/intake/inquiries/${q.id}`}
                    method="PATCH"
                    fields={[
                      {
                        name: "status",
                        label: t("closeAs"),
                        type: "select",
                        required: true,
                        options: CLOSED.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
                      },
                    ]}
                    submitLabel={t("close")}
                  />
                ) : null}
                {can.declineMail ? (
                  <ApiButton
                    endpoint={`/api/intake/inquiries/${q.id}/decline-mail`}
                    label={t("declineMail")}
                    title={t("declineMailHint")}
                    confirm={t("declineMailConfirm", { email: q.contactEmail ?? "" })}
                    icon={<Mail />}
                    size="default"
                  />
                ) : null}
                {can.decide && closed ? (
                  <ApiButton
                    endpoint={`/api/intake/inquiries/${q.id}`}
                    method="PATCH"
                    body={{ status: "new" }}
                    label={t("reopen")}
                    size="default"
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("request")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                {rows.map(([k, v], i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {q.message ? (
                <div className="space-y-1 border-t pt-4">
                  <p className="text-xs text-muted-foreground">{t("message")}</p>
                  <p className="text-sm whitespace-pre-wrap" dir="auto">
                    {q.message}
                  </p>
                </div>
              ) : null}
              {/* The self-check is asked on the public form only. */}
              {q.source === "website" ? (
                <div className="space-y-2 border-t pt-4">
                  <p className="text-xs text-muted-foreground">{t("selfCheck")}</p>
                  <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                    {SELF_CHECKS.map((k) => {
                      const v = selfCheck[snake(k)] ?? selfCheck[k];
                      const Icon = v === true ? CircleCheck : v === false ? MinusCircle : Circle;
                      return (
                        <li key={k} className="flex items-center gap-2">
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span>{ti(`selfCheck.${k}`)}</span>
                          <span className="text-xs text-muted-foreground">
                            {v === true ? t("yes") : v === false ? t("no") : t("notAnswered")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardTitle className="text-base">{t("discovery")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5">
              {data.discoverySessions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDiscovery")}</p> : null}
              {data.discoverySessions.map((s) => (
                <div key={s.id} className="space-y-2 border-t pt-4 text-sm first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{when(s.scheduledAt)}</span>
                    <Badge variant="outline">{t(`modes.${s.mode}`)}</Badge>
                    {s.outcome ? <Badge variant="secondary">{t(`outcomes.${s.outcome}`)}</Badge> : null}
                    {s.heldAt ? (
                      <span className="text-xs text-muted-foreground">{t("held", { date: when(s.heldAt) })}</span>
                    ) : null}
                  </div>
                  {s.attendees ? <p className="text-muted-foreground">{s.attendees}</p> : null}
                  {s.notes ? (
                    <p className="whitespace-pre-wrap" dir="auto">
                      {s.notes}
                    </p>
                  ) : null}
                  {can.work && !q.clientOrgId ? (
                    <FormDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          <NotebookPen />
                          {t("record")}
                        </Button>
                      }
                      title={t("record")}
                      description={t("recordHint")}
                      endpoint={`/api/intake/discovery/${s.id}`}
                      method="PATCH"
                      fields={[
                        {
                          name: "outcome",
                          label: t("outcome"),
                          type: "select",
                          required: true,
                          defaultValue: s.outcome ?? undefined,
                          options: (["proceed", "needs_followup", "not_a_fit"] as const).map((o) => ({
                            value: o,
                            label: t(`outcomes.${o}`),
                          })),
                        },
                        {
                          name: "notes",
                          label: t("notes"),
                          type: "textarea",
                          maxLength: 8000,
                          defaultValue: s.notes ?? undefined,
                        },
                      ]}
                      submitLabel={t("record")}
                    />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="gap-4 py-5 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between gap-4 px-5">
              <CardTitle className="text-base">{t("history")}</CardTitle>
              {can.work ? (
                <FormDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {t("addNote")}
                    </Button>
                  }
                  title={t("addNote")}
                  endpoint={`/api/intake/inquiries/${q.id}/notes`}
                  fields={[{ name: "note", label: t("note"), type: "textarea", required: true, maxLength: 4000 }]}
                  submitLabel={t("addNote")}
                />
              ) : null}
            </CardHeader>
            <CardContent className="px-5">
              <ol className="space-y-3 text-sm">
                {data.events.map((e) => (
                  <li key={e.id} className="space-y-0.5">
                    <p>
                      <span className="font-medium">{e.actorName ?? t("public")}</span>{" "}
                      <span className="text-muted-foreground">
                        {e.event === "status_changed"
                          ? t("events.status_changed", { from: status(e.fromStatus), to: status(e.toStatus) })
                          : e.event === "owner_changed" && nameOf(e.meta.owner_user_id as string | null)
                            ? t("events.owner_assigned", { name: nameOf(e.meta.owner_user_id as string)! })
                            : e.event === "conflict_checked"
                              ? t("events.conflict_checked", {
                                  status: t(`conflicts.${String(e.meta.conflict_status ?? "not_checked")}`),
                                })
                              : ["submitted", "entered", "acknowledged", "decline_mailed", "owner_changed", "converted", "note", "anonymised"].includes(e.event)
                                ? t(`events.${e.event}`)
                                : e.event}
                      </span>{" "}
                      <span className="ms-1 text-xs text-muted-foreground tabular-nums">{when(e.createdAt)}</span>
                    </p>
                    {e.note ? (
                      <p className="whitespace-pre-wrap" dir="auto">
                        {e.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardDescription>{t("owner")}</CardDescription>
              <CardTitle className="text-base">{nameOf(q.ownerUserId) ?? q.ownerName ?? (q.ownerUserId ? "—" : t("unassigned"))}</CardTitle>
            </CardHeader>
            {can.decide && !q.clientOrgId ? (
              <CardContent className="px-5">
                <FormDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      <UserPlus />
                      {t("assign")}
                    </Button>
                  }
                  title={t("assign")}
                  description={t("assignHint")}
                  endpoint={`/api/intake/inquiries/${q.id}`}
                  method="PATCH"
                  fields={[
                    {
                      name: "ownerUserId",
                      label: t("owner"),
                      type: "select",
                      required: true,
                      defaultValue: q.ownerUserId ?? undefined,
                      options: data.team.map((m) => ({ value: m.id, label: m.name })),
                    },
                  ]}
                  submitLabel={t("assign")}
                />
              </CardContent>
            ) : null}
          </Card>

          <Card className="gap-3 py-5 shadow-xs">
            <CardHeader className="px-5">
              <CardDescription>{t("conflictCheck")}</CardDescription>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-muted-foreground" />
                {t(`conflicts.${q.conflictStatus}`)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 text-sm">
              {q.conflictNote ? (
                <p className="whitespace-pre-wrap">{q.conflictNote}</p>
              ) : (
                <p className="text-muted-foreground">{t("conflictHint")}</p>
              )}
              {can.decide && !q.clientOrgId ? (
                <FormDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {t("recordConflict")}
                    </Button>
                  }
                  title={t("conflictCheck")}
                  description={t("conflictHint")}
                  endpoint={`/api/intake/inquiries/${q.id}`}
                  method="PATCH"
                  fields={[
                    {
                      name: "conflictStatus",
                      label: t("conflict"),
                      type: "select",
                      required: true,
                      defaultValue: q.conflictStatus === "not_checked" ? "clear" : q.conflictStatus,
                      options: (["clear", "flagged", "waived"] as const).map((s) => ({ value: s, label: t(`conflicts.${s}`) })),
                    },
                    {
                      name: "conflictNote",
                      label: t("conflictNote"),
                      type: "textarea",
                      maxLength: 2000,
                      defaultValue: q.conflictNote ?? undefined,
                    },
                  ]}
                  submitLabel={t("recordConflict")}
                />
              ) : null}
            </CardContent>
          </Card>

          {q.clientOrgId ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardContent className="space-y-3 px-5 text-sm">
                <p>{t("converted")}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/clients/${q.clientOrgId}`}>{t("openClient")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : can.decide && !closed ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("convert")}</CardTitle>
                <CardDescription>{can.convert ? t("convertHint") : t("convertBlocked")}</CardDescription>
              </CardHeader>
              {can.convert ? (
                <CardContent className="px-5">
                  <ConvertDialog
                    inquiryId={q.id}
                    orgName={q.orgName ?? ""}
                    orgNameAr={q.orgNameAr ?? null}
                    clients={data.clients}
                    existingClientId={q.source === "existing_client" ? q.sourceClientOrgId : null}
                    consultants={[
                      ...(data.leads ?? []).map((l) => ({ id: l.userId, name: l.name })),
                      ...data.team.filter((m) => m.role === "consultant" && !data.leads?.some((l) => l.userId === m.id)),
                    ]}
                  />
                </CardContent>
              ) : null}
            </Card>
          ) : null}

          {data.leads && !q.clientOrgId && !closed ? (
            <Card className="gap-3 py-5 shadow-xs">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("leads")}</CardTitle>
                <CardDescription>{t("leadsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 text-sm">
                {data.leads.length === 0 ? <p className="text-muted-foreground">{t("noLeads")}</p> : null}
                {data.leads.map((l) => (
                  <div key={l.userId} className="space-y-1 border-t pt-3 first:border-t-0 first:pt-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        l.matchedServices.length
                          ? t("matched", {
                              services: l.matchedServices.map((c) => label(data.options.services, c)).join(ar ? "، " : ", "),
                            })
                          : null,
                        l.sectorMatch ? t("sectorMatch") : null,
                        l.speaksLanguage ? t("speaks") : null,
                        l.acceptingNewClients ? null : t("notAccepting"),
                        t("activeClients", { n: l.activeClients }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
