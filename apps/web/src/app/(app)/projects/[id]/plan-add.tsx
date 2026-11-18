"use client";

import { Plus } from "@/components/animate-ui/icons/plus";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { downloadExport } from "@/components/export-button";
import { FormDialog } from "@/components/form-dialog";
import { RowMenu, type RowMenuItem } from "@/components/row-menu";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RecommendationDialog } from "./plan-dialogs";

/**
 * Plan's one main action (page audit 4.3, U06: there were four "Add a
 * recommendation" buttons, Excel and Import beside them): one solid "Add a
 * recommendation", and a menu beside it with the rarer ways in: add a finding,
 * import a plan from a file, download the plan as Excel. Each is drawn only
 * when the server said this person may do it.
 */
export function PlanAdd(props: {
  projectId: string;
  client: boolean;
  findings: { id: string; title: string }[];
  scope: {
    departments: { id: string; nameAr: string; nameEn: string | null }[];
    accountables: { userId: string; name: string }[];
  };
  can: { recommendation: boolean; finding: boolean; import: boolean; excel: boolean };
}) {
  const t = useTranslations("plan");
  const tVis = useTranslations("visibility");
  const tImport = useTranslations("planImport");
  const tExport = useTranslations("exports");
  const tp = useTranslations("projectPage.menu");
  const router = useRouter();
  const locale = useLocale();

  const items: RowMenuItem[] = [
    {
      key: "finding",
      label: t("findings.add"),
      allowed: props.can.finding,
      dialog: (control) => (
        <FormDialog
          control={control}
          title={t("findings.add")}
          description={t("findings.addHint")}
          endpoint={`/api/projects/${props.projectId}/findings`}
          fields={[
            { name: "title", label: t("findings.field"), required: true, maxLength: 300 },
            { name: "description", label: t("findings.description"), type: "textarea", maxLength: 8000 },
            ...(props.client
              ? [
                  {
                    name: "visibility",
                    label: t("findings.visibility"),
                    type: "select" as const,
                    required: true,
                    options: [
                      { value: "shared", label: tVis("shared") },
                      { value: "firm_private", label: tVis("firm_private") },
                    ],
                  },
                ]
              : []),
          ]}
          submitLabel={t("findings.add")}
        />
      ),
    },
    { key: "import", label: tImport("button"), allowed: props.can.import, onSelect: () => router.push(`/projects/${props.projectId}/import`) },
    {
      key: "excel",
      label: tExport("downloadExcel"),
      allowed: props.can.excel,
      onSelect: () =>
        void downloadExport(`/api/projects/${props.projectId}/export`, locale).then((failed) => (failed ? toast.error(tExport(failed)) : undefined)),
    },
  ];

  return (
    <div className="flex items-center gap-1">
      {props.can.recommendation ? (
        <RecommendationDialog
          projectId={props.projectId}
          client={props.client}
          scope={props.scope}
          findings={props.findings}
          trigger={
            <Button size="sm">
              <Plus />
              {t("rec.add")}
            </Button>
          }
        />
      ) : null}
      <RowMenu label={tp("planLabel")} items={items} />
    </div>
  );
}
