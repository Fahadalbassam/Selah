import { useTranslations } from "next-intl";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/slips";

/** Open actions by how long they are past the date agreed at release (F17), in the buckets audit committees report. */
export function LateAgainstOriginal({ late }: { late: Record<AgingBucket, number> }) {
  const t = useTranslations("metrics");
  const none = AGING_BUCKETS.every((b) => !late[b.key]);
  return (
    <Card className="gap-3 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("lateTitle")}</CardTitle>
        <CardDescription>{none ? t("lateNone") : t("lateHint")}</CardDescription>
      </CardHeader>
      {none ? null : (
        <CardContent className="grid grid-cols-2 gap-4 px-5 xl:grid-cols-4">
          {AGING_BUCKETS.map((b) => (
            <StatTile key={b.key} label={t(`aging.${b.key}`)} value={late[b.key]} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
