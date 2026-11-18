import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import type { OpenRequest } from "@/components/assistant/store";
import { withPrincipal } from "@/server/page";
import { myClientAi } from "@/services/client-ai";
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
 * is where links to a chat or a record land: it opens the card with them. A
 * client's admin agrees to it or withdraws on its own view, /assistant/consent
 * ("Assistant consent" in the user menu); before the assistant is on for
 * them, this address takes them there.
 */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = search.parse(await searchParams);
  const clientAi = await withPrincipal((tx, principal) => myClientAi(tx, principal));
  if (clientAi && !clientAi.on) {
    if (clientAi.canConsent || clientAi.canWithdraw) redirect("/assistant/consent");
    notFound();
  }
  const t = await getTranslations("assistant");
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
      <PageHeader title={t("title")} description={clientAi ? t("clientSubtitle") : t("subtitle")} />
      <OpenAssistant request={request} />
      <p className="text-xs text-muted-foreground">{clientAi ? t("clientDisclaimer") : t("disclaimer")}</p>
    </>
  );
}
