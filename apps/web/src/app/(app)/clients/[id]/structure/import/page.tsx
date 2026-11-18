import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/ids";
import { localName } from "@/lib/names";
import { withPrincipal } from "@/server/page";
import { importContext } from "@/services/org-chart-import";
import { OrgChartImportWizard } from "./import-wizard";

// Org chart, part 4: bring a client's structure into the firm's draft from
// the Excel template, a Word outline or pasted text, through one review step
// before anything is saved. For the draft's editors (the firm admin, the
// client's lead and deputy, consultants staffed and not observing on one of
// its open projects); anyone else, and another client, 404. Nothing is
// published here.
export default async function StructureImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const view = await withPrincipal((tx, principal) => importContext(tx, principal, id));
  if (!view) notFound();
  const t = await getTranslations("orgChartImport");
  const ar = (await getLocale()) === "ar";
  const client = localName(view.client, ar);
  return (
    <>
      {/* The Structure tab exists once the draft holds something; before that, back to the client. */}
      <Link
        href={view.draftHasContent ? `/clients/${id}/structure?version=draft` : `/clients/${id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {view.draftHasContent ? t("back") : client}
      </Link>
      <PageHeader title={t("title")} description={t("description", { client })} />
      <OrgChartImportWizard
        clientId={id}
        ctx={view.ctx}
        assistant={view.assistant}
        draft={view.draftHasContent ? { units: view.ctx.draft.units.length, positions: view.ctx.draft.positions.length } : null}
      />
    </>
  );
}
