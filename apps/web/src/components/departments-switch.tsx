"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Whether the client uses departments. Admins (the firm admin, the client's
 * admin) get the switch; everyone else reads the state in words, because a
 * switch they cannot change is drawn dimmed and reads as "off" (page audit B4).
 */
export function DepartmentsSwitch({ on, manage, busy = false, onChange }: { on: boolean; manage: boolean; busy?: boolean; onChange?: (on: boolean) => void }) {
  const t = useTranslations("engagement.departments");
  const tr = useTranslations("engagement");
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardContent className="flex items-start justify-between gap-6 px-5">
        <div className="space-y-1">
          {manage ? (
            <Label htmlFor="departments-on" className="text-sm font-medium">
              {t("switch")}
            </Label>
          ) : (
            <p className="text-sm font-medium">{t("switch")}</p>
          )}
          <p className="max-w-2xl text-sm text-muted-foreground">{t("switchHint")}</p>
        </div>
        {manage ? (
          <Switch id="departments-on" checked={on} disabled={busy} onCheckedChange={(v) => onChange?.(v)} />
        ) : (
          <p className="shrink-0 text-sm font-medium" data-state={on ? "on" : "off"}>
            {on ? tr("on") : tr("off")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
