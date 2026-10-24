import { getLocale, getTranslations } from "next-intl/server";
import { GroupProgress } from "@/components/group-progress";
import { PageHeader } from "@/components/page-header";
import { localLabel } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { groupRollup } from "@/services/client-groups";

// The group's roll-up on the client side (F34 part 2): only for the people of
// the holding the firm admin named. Counts per member company, nothing to
// open: a linked company's own records stay with that company.
export default async function GroupPage() {
  const data = await withPrincipal((tx, principal) => groupRollup(tx, principal));
  const t = await getTranslations("clientGroups");
  const ar = (await getLocale()) === "ar";

  return (
    <>
      <PageHeader title={localLabel(data.group, ar)} description={t("clientHint")} />
      <GroupProgress total={data.total} companies={data.companies} links={false} />
    </>
  );
}
