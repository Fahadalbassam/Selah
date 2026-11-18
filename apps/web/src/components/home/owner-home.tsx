import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HOME_ROWS, showAllHref, shown, type HomeSection as SectionKey } from "@/lib/home";
import type { OwnerHome } from "@/services/home";
import { HomeSection } from "./home-section";
import { actionRows, DocumentsSection, FollowUpsSection, MeetingSections } from "./my-work";

/**
 * The action owner's home (page audit 4.2): their actions in three groups
 * (waiting for them, with the consultant, finished and folded), then the
 * files asked of them, their meetings and their follow-ups. Nothing else.
 */
export async function OwnerHomeLists({ data, open }: { data: OwnerHome; open: SectionKey | null }) {
  const [t, tHome] = await Promise.all([getTranslations("home.owner"), getTranslations("home")]);
  const none = data.waiting.length + data.withConsultant.length + data.finished.length === 0;
  const finishedOpen = open === "finished";
  const finished = await actionRows(data.finished);
  return (
    <>
      {none ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <HomeSection id="waiting" title={t("waiting.title")} open={open === "waiting"} rows={await actionRows(data.waiting)} />
      <HomeSection
        id="withConsultant"
        title={t("withConsultant.title")}
        description={t("withConsultant.description")}
        open={open === "withConsultant"}
        rows={await actionRows(data.withConsultant)}
      />
      {finished.length ? (
        <details id="finished" open={finishedOpen} className="group scroll-mt-16 space-y-3">
          <summary className="cursor-pointer text-base font-semibold">{t("finished.title", { n: finished.length })}</summary>
          <ul className="mt-3 divide-y overflow-hidden rounded-xl border bg-card shadow-xs">{shown(finished, finishedOpen)}</ul>
          {!finishedOpen && finished.length > HOME_ROWS ? (
            <Link href={showAllHref("finished")} className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
              {tHome("showAll", { n: finished.length })}
            </Link>
          ) : null}
        </details>
      ) : null}
      <DocumentsSection rows={data.documents} open={open} />
      <MeetingSections replies={data.replies} next={data.nextMeeting} open={open} />
      <FollowUpsSection rows={data.followUps} open={open} />
    </>
  );
}
