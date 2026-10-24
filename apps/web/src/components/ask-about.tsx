"use client";

import { useTranslations } from "next-intl";
import { Bot } from "@/components/animate-ui/icons/bot";
import { assistant } from "@/components/assistant/store";
import { Button } from "@/components/ui/button";

/** Starts an assistant chat about one record (firm staff, and client people with the assistant on). The chat keeps the record as its case. */
export function AskAbout({
  projectId,
  type,
  id,
  size = "sm",
}: {
  projectId: string;
  type: "recommendation" | "action" | "finding" | "meeting" | "document";
  id: string;
  size?: "sm" | "icon-sm";
}) {
  const t = useTranslations("assistant");
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      title={t("askAbout")}
      aria-label={size === "icon-sm" ? t("askAbout") : undefined}
      aria-controls="assistant-card"
      onClick={() => assistant.open({ projectId, case: { type, id } })}
    >
      <Bot animateOnHover className="size-4" />
      {size === "icon-sm" ? null : t("askAbout")}
    </Button>
  );
}
