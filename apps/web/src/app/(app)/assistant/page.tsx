import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import type { OpenRequest } from "@/components/assistant/store";
import { withPrincipal } from "@/server/page";
import { myClientAi } from "@/services/client-ai";
import { ClientAiConsent, WithdrawClientAi } from "./client-consent";
import { OpenAssistant } from "./open-assistant";

const search = z.object({
  chat: z.uuid().optional().catch(undefined),
  project: z.uuid().optional().catch(undefined),
  // "action:<id>": a new chat about that record. The card checks both against what the person may ask about.
  case: z
    .string()
    .regex(/^(recommendation|action|finding|meeting|document):[0-9a-f-]{36}$/)
    .optional()
    .catch(undefined),
});

/**
 * The assistant itself is a floating card (components/assistant). This page
 * is where a client's admin agrees to it or withdraws, and where links to a
 * chat or a record land: it opens the card with them.
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = search.parse(await searchParams);
  const clientAi = await withPrincipal((tx, principal) => myClientAi(tx, principal));
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
  const request: OpenRequest = params.chat
    ? { chatId: params.chat }
    : params.project
      ? {
          projectId: params.project,
          case: params.case ? { type: params.case.split(":")[0] as "action", id: params.case.split(":")[1]! } : undefined,
        }
      : null;
  return (
    <>
      <PageHeader title={t("title")} description={clientAi ? t("clientSubtitle") : t("subtitle")}>
        {clientAi?.canWithdraw ? <WithdrawClientAi /> : null}
      </PageHeader>
      <OpenAssistant request={request} />
      <p className="text-xs text-muted-foreground">{clientAi ? t("clientDisclaimer") : t("disclaimer")}</p>
    </>
  );
}
