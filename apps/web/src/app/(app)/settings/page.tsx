import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { getFirmSettings } from "@/services/firm-settings";
import { FirmSettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const data = await withPrincipal(async (tx, principal) =>
    principal.role === "firm_admin" ? getFirmSettings(tx, principal) : null,
  );
  if (!data) notFound();
  const [t, format] = await Promise.all([getTranslations("settings"), getFormatter()]);
  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          data.updatedAt
            ? t("updated", { date: format.dateTime(new Date(data.updatedAt), { dateStyle: "medium" }) })
            : t("defaults")
        }
      />
      <FirmSettingsForm initial={data.settings} />
    </>
  );
}
