"use client";

import { MessageSquare } from "@/components/animate-ui/icons/message-square";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ASK_EVENT } from "@/lib/help";

/**
 * "Ask your consultant" on a client's action page (F13): a question about
 * the work goes in the action's own thread, so this opens it with the lead
 * mentioned instead of sending the reader to mail.
 */
export function AskConsultant() {
  const t = useTranslations("help.ask");
  return (
    <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))}>
      <MessageSquare animateOnHover className="size-4" />
      {t("button")}
    </Button>
  );
}
