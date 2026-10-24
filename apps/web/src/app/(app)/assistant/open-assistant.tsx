"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Bot } from "@/components/animate-ui/icons/bot";
import { assistant, type OpenRequest } from "@/components/assistant/store";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** The assistant lives in a floating card: this page opens it (with the chat or record a link named) and says where it is. */
export function OpenAssistant({ request }: { request: OpenRequest }) {
  const t = useTranslations("assistant");
  useEffect(() => {
    assistant.open(request);
    // Once per visit of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Empty className="rounded-xl border bg-card shadow-xs">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bot animateOnView />
        </EmptyMedia>
        <EmptyTitle>{t("card.pageTitle")}</EmptyTitle>
        <EmptyDescription>{t("card.pageHint")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => assistant.open()} aria-controls="assistant-card">
          {t("card.open")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
