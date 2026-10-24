import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ToneBadge } from "@/components/tone-badge";
import { FIRM_TIME_ZONE } from "@/lib/dates";
import type { ConflictSearch } from "@/services/conflicts";

/** What the last conflict search found, as it was kept (wave 1, item 8). The firm admin's view. */
export async function ConflictMatches({ search }: { search: ConflictSearch | null }) {
  const t = await getTranslations("conflicts");
  const format = await getFormatter();
  if (!search) return <p className="text-muted-foreground">{t("notRun")}</p>;
  const when = format.dateTime(new Date(search.searchedAt), { dateStyle: "medium", timeStyle: "short", timeZone: FIRM_TIME_ZONE });
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t.rich("summary", { when, name: search.searchedBy ?? "—", count: search.matches.length, who: (c) => <bdi>{c}</bdi> })}
      </p>
      {search.matches.length === 0 ? <p>{t("none")}</p> : null}
      <ul className="space-y-2">
        {search.matches.map((m) => (
          <li key={`${m.kind}-${m.id}`} className="space-y-1 rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={m.kind === "client" ? `/clients/${m.id}` : `/inquiries/${m.id}`} className="font-medium hover:underline" dir="auto">
                {m.label}
              </Link>
              <ToneBadge tone={m.kind === "client" && m.status === "current" ? "waiting" : "neutral"}>
                {m.kind === "client" ? t(`clientStatus.${m.status}`) : t("inquiry")}
              </ToneBadge>
            </div>
            <p className="text-xs text-muted-foreground">
              {m.reasons.map((r) => t(`reasons.${r}`)).join(" · ")}
              {m.people?.length ? (
                <>
                  {" · "}
                  <span dir="auto">{m.people.join("، ")}</span>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
