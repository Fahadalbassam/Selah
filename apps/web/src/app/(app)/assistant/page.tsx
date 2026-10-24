import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { authorize } from "@/authz";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { caseLabel } from "@/services/assistant";
import { myClientAi } from "@/services/client-ai";
import { listProjects } from "@/services/queries";
import { AssistantWorkspace, type NewChatCase } from "./assistant-workspace";
import { ClientAiConsent, WithdrawClientAi } from "./client-consent";

const search = z.object({
  chat: z.uuid().optional().catch(undefined),
  project: z.uuid().optional().catch(undefined),
  // "action:<id>": a new chat about that record ("Ask about this" on record pages).
  case: z
    .string()
    .regex(/^(recommendation|action|finding|meeting|document):[0-9a-f-]{36}$/)
    .optional()
    .catch(undefined),
});

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = search.parse(await searchParams);
  const locale = await getLocale();
  const { projects, initialCase, initialProjectId, clientAi } = await withPrincipal(async (tx, principal) => {
    const all = await listProjects(tx, principal);
    const projects = all.filter(
      (p) => authorize(principal, "assistant.query", { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id }).allowed,
    );
    let initialCase: NewChatCase | null = null;
    if (params.project && params.case && projects.some((p) => p.id === params.project)) {
      const [type, id] = params.case.split(":") as [NewChatCase["type"], string];
      const label = await caseLabel(tx, params.project, { type, id });
      if (label) initialCase = { projectId: params.project, type, id, label };
    }
    return {
      // The client's people (F39): null for firm staff.
      clientAi: await myClientAi(tx, principal),
      projects: projects.map((p) => ({ id: p.id, title: p.title, client: locale === "ar" && p.orgNameAr ? p.orgNameAr : p.orgName })),
      initialCase,
      // ?project= alone (no case) still picks that project, when the user may ask about it.
      initialProjectId: params.project && projects.some((p) => p.id === params.project) ? params.project : null,
    };
  });
  const t = await getTranslations("assistant");
  const tRole = await getTranslations("role");
  // The client's admin reads the firm's offer and agrees before anyone at the client uses it.
  if (clientAi && !clientAi.on) {
    if (!clientAi.canConsent && !clientAi.canWithdraw) notFound();
    return (
      <>
        <PageHeader title={t("title")} description={t("clientSubtitle")}>
          {clientAi.canWithdraw ? <WithdrawClientAi /> : null}
        </PageHeader>
        {clientAi.canConsent ? (
          <ClientAiConsent version={clientAi.version} roles={clientAi.roles.map((r) => tRole(r))} />
        ) : (
          // Agreed, but the firm offered it to other roles than the admin's own.
          <p className="text-sm text-muted-foreground">{t("clientNotForYou", { roles: clientAi.roles.map((r) => tRole(r)).join(" · ") })}</p>
        )}
      </>
    );
  }
  if (projects.length === 0) notFound();
  return (
    <>
      <PageHeader title={t("title")} description={clientAi ? t("clientSubtitle") : t("subtitle")}>
        {clientAi?.canWithdraw ? <WithdrawClientAi /> : null}
      </PageHeader>
      {clientAi ? (
        <p className="text-sm text-muted-foreground">{t("clientUsage", { used: clientAi.usedToday, limit: clientAi.dailyLimit })}</p>
      ) : null}
      <AssistantWorkspace projects={projects} initialChatId={params.chat ?? null} initialCase={initialCase} initialProjectId={initialProjectId} />
      <p className="text-xs text-muted-foreground">{clientAi ? t("clientDisclaimer") : t("disclaimer")}</p>
    </>
  );
}
