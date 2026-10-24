import { getFormatter, getTranslations } from "next-intl/server";
import { Clock } from "@/components/animate-ui/icons/clock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LadderStep } from "@/services/follow-through";

/**
 * The reminder ladder of an action (F12): each step for the current due
 * date, who it reaches, and whether it has gone out. Shown to everyone who
 * can see the action, so the owner knows who hears about it next.
 */
export async function ReminderLadder({ running, steps }: { running: boolean; steps: LadderStep[] }) {
  if (steps.length === 0) return null;
  const [t, format] = await Promise.all([getTranslations("action.ladder"), getFormatter()]);
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const list = (xs: string[]) => format.list(xs, { type: "conjunction" });
  return (
    <Card className="gap-3 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{running ? t("hint") : t("paused")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <ol className="space-y-3 border-s ps-4">
          {steps.map((s) => (
            <li key={s.level} className={cn("relative space-y-0.5 text-sm", !running && !s.sentAt && "text-muted-foreground")}>
              <span
                aria-hidden
                className={cn(
                  "absolute -start-[1.3125rem] top-1.5 size-2 rounded-full border",
                  s.sentAt ? "border-foreground bg-foreground" : "border-field bg-card",
                )}
              />
              <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium">{t(`steps.${s.level}`)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {s.sentAt ? t("sent", { date: format.dateTime(s.sentAt, { dateStyle: "medium" }) }) : t("due", { date: day(s.onDate) })}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{list(s.audience.map((a) => t(`audience.${a}`)))}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
