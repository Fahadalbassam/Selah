"use client";

import { Pencil, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Users } from "@/components/animate-ui/icons/users";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ApiButton, callApi, FormDialog } from "@/components/form-dialog";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { engagementError } from "@/lib/engagement";

import { localLabel } from "@/lib/names";
export interface DepartmentsData {
  id: string;
  departmentsEnabled: boolean;
  canManageDepartments: boolean;
  departments: {
    id: string;
    nameAr: string;
    nameEn: string | null;
    active: boolean;
    members: { userId: string; name: string; isHead: boolean }[];
  }[];
}

/**
 * A client's departments: switch them on, name them and say who is in each.
 * The firm admin and the client's admin manage them; the database decides
 * who sees work filed under one (docs/engagement.md).
 */
export function DepartmentsManager({ data, people }: { data: DepartmentsData; people: { userId: string; name: string }[] }) {
  const t = useTranslations("engagement.departments");
  const tc = useTranslations("common");
  const tr = useTranslations("engagement");
  const router = useRouter();
  const ar = useLocale() === "ar";
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const manage = data.canManageDepartments;

  async function toggle(on: boolean) {
    if (!(await confirm(on ? t("onConfirm") : t("offConfirm")))) return;
    setBusy(true);
    const r = await callApi(`/api/orgs/${data.id}/engagement`, "PATCH", { departmentsEnabled: on });
    setBusy(false);
    if (!r.ok) {
      const key = engagementError(r.message);
      return toast.error(key && tr.has(`errors.${key}`) ? tr(`errors.${key}`) : tc(`errors.${r.error}`));
    }
    toast.success(tc("saved"));
    router.refresh();
  }

  const name = (d: DepartmentsData["departments"][number]) => localLabel(d, ar);

  return (
    <div className="space-y-6">
      <Card className="gap-4 py-5 shadow-xs">
        <CardContent className="flex items-start justify-between gap-6 px-5">
          <div className="space-y-1">
            <Label htmlFor="departments-on" className="text-sm font-medium">
              {t("switch")}
            </Label>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("switchHint")}</p>
          </div>
          <Switch
            id="departments-on"
            checked={data.departmentsEnabled}
            disabled={!manage || busy}
            onCheckedChange={(v) => void toggle(v)}
          />
        </CardContent>
      </Card>

      <SectionHeader title={t("list")} description={data.departmentsEnabled ? t("listHintOn") : t("listHintOff")}>
        {manage ? (
          <FormDialog
            trigger={
              <Button size="sm">
                <Plus />
                {t("add")}
              </Button>
            }
            title={t("add")}
            description={t("addHint")}
            endpoint={`/api/orgs/${data.id}/departments`}
            fields={[
              { name: "nameAr", label: t("nameAr"), required: true, dir: "rtl" },
              { name: "nameEn", label: t("nameEn"), dir: "ltr" },
            ]}
            submitLabel={t("create")}
          />
        ) : null}
      </SectionHeader>

      {data.departments.length === 0 ? (
        <EmptyState icon={<Users animateOnView />} description={manage ? t("emptyManage") : t("empty")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.departments.map((d) => {
            const inIt = new Set(d.members.map((m) => m.userId));
            const candidates = people.filter((p) => !inIt.has(p.userId));
            return (
              <Card key={d.id} className="gap-3 py-5 shadow-xs">
                <CardHeader className="flex flex-row items-start justify-between gap-3 px-5">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {name(d)}
                      {d.active ? null : <ToneBadge tone="neutral">{t("switchedOff")}</ToneBadge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{ar ? d.nameEn : d.nameEn ? d.nameAr : null}</p>
                  </div>
                  {manage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <FormDialog
                        trigger={
                          <Button size="icon" variant="ghost" className="size-7" aria-label={t("rename")}>
                            <Pencil />
                          </Button>
                        }
                        title={t("rename")}
                        endpoint={`/api/departments/${d.id}`}
                        method="PATCH"
                        sendEmptyAsNull
                        fields={[
                          { name: "nameAr", label: t("nameAr"), required: true, dir: "rtl", defaultValue: d.nameAr },
                          { name: "nameEn", label: t("nameEn"), dir: "ltr", defaultValue: d.nameEn ?? undefined },
                        ]}
                        submitLabel={tc("save")}
                      />
                      <ApiButton
                        endpoint={`/api/departments/${d.id}`}
                        method="PATCH"
                        body={{ active: !d.active }}
                        label={d.active ? t("switchOff") : t("switchOn")}
                        variant="ghost"
                        confirm={d.active ? t("switchOffConfirm") : undefined}
                      />
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  {d.members.length === 0 ? <p className="text-sm text-muted-foreground">{t("noMembers")}</p> : null}
                  <ul className="divide-y">
                    {d.members.map((m) => (
                      <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1 font-medium">{m.name}</span>
                        {m.isHead ? (
                          <ToneBadge tone="active" className="gap-1">
                            <Crown className="size-3" />
                            {t("head")}
                          </ToneBadge>
                        ) : null}
                        {manage ? (
                          <>
                            <ApiButton
                              endpoint={`/api/departments/${d.id}/members/${m.userId}`}
                              method="PUT"
                              body={{ isHead: !m.isHead }}
                              label={m.isHead ? t("notHead") : t("makeHead")}
                              variant="ghost"
                            />
                            <ApiButton
                              endpoint={`/api/departments/${d.id}/members/${m.userId}`}
                              method="DELETE"
                              label={t("remove")}
                              variant="ghost"
                              confirm={t("removeConfirm", { name: m.name })}
                            />
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {manage && d.active ? (
                    candidates.length ? (
                      <FormDialog
                        trigger={
                          <Button size="sm" variant="outline">
                            <UserPlus />
                            {t("addPerson")}
                          </Button>
                        }
                        title={t("addPerson")}
                        description={t("addPersonHint")}
                        endpoint={`/api/departments/${d.id}/members/:userId`}
                        method="PUT"
                        extra={{ isHead: false }}
                        fields={[
                          {
                            name: "userId",
                            label: t("person"),
                            type: "select",
                            required: true,
                            options: candidates.map((p) => ({ value: p.userId, label: p.name })),
                          },
                        ]}
                        submitLabel={t("add")}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("everyoneIn")}</p>
                    )
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
