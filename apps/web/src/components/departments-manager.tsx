"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { Crown } from "@/components/animate-ui/icons/crown";
import { Plus } from "@/components/animate-ui/icons/plus";
import { Users } from "@/components/animate-ui/icons/users";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { MoveDepartmentWork } from "@/components/move-department-work";
import { callApi, FormDialog } from "@/components/form-dialog";
import { RowMenu, useRowCall } from "@/components/row-menu";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DepartmentsSwitch } from "@/components/departments-switch";
import { engagementError } from "@/lib/engagement";
import { localLabel } from "@/lib/names";
import { departmentCardPlan, memberRowPlan } from "@/lib/row-actions";

export interface DepartmentsData {
  id: string;
  departmentsEnabled: boolean;
  canManageDepartments: boolean;
  /** Restructures: the firm admin moves a department's unfinished work to another. */
  canMoveWork: boolean;
  departments: {
    id: string;
    nameAr: string;
    nameEn: string | null;
    active: boolean;
    /** Whether this reader may open the department's page (its work). Names and members are for everyone. */
    canOpen: boolean;
    members: { userId: string; name: string; isHead: boolean }[];
  }[];
}

/**
 * A client's departments: switch them on, name them and say who is in each.
 * The firm admin and the client's admin manage them; the database decides
 * who sees work filed under one (docs/engagement.md). Each card shows one
 * button, "Add a person"; renaming, moving its work and switching it off are
 * in the card's menu, and making someone head or taking them out in each
 * person's menu (page audit U15).
 */
export function DepartmentsManager({ data, people }: { data: DepartmentsData; people: { userId: string; name: string }[] }) {
  const t = useTranslations("engagement.departments");
  const tc = useTranslations("common");
  const tr = useTranslations("engagement");
  const router = useRouter();
  const ar = useLocale() === "ar";
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const call = useRowCall();
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
      <DepartmentsSwitch on={data.departmentsEnabled} manage={manage} busy={busy} onChange={(v) => void toggle(v)} />


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
            const targets = data.departments.filter((o) => o.id !== d.id && o.active).map((o) => ({ id: o.id, name: name(o) }));
            const card = departmentCardPlan({
              addPerson: manage && d.active && candidates.length > 0,
              rename: manage,
              moveWork: manage && data.canMoveWork && targets.length > 0,
              switchOff: manage && d.active,
              switchOn: manage && !d.active,
            });
            const inMenu = new Set<string>(card.menu);
            return (
              <Card key={d.id} className="gap-3 py-5 shadow-xs">
                <CardHeader className="flex flex-row items-start justify-between gap-3 px-5">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {/* A link only where the reader may open the department's page (its work). */}
                      {d.canOpen ? (
                        <Link href={`/departments/${d.id}`} className="hover:underline">
                          {name(d)}
                        </Link>
                      ) : (
                        <span>{name(d)}</span>
                      )}
                      {d.active ? null : <ToneBadge tone="neutral">{t("switchedOff")}</ToneBadge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{ar ? d.nameEn : d.nameEn ? d.nameAr : null}</p>
                  </div>
                  <RowMenu
                    label={tc("moreFor", { name: name(d) })}
                    items={[
                      {
                        key: "rename",
                        label: t("rename"),
                        allowed: inMenu.has("rename"),
                        dialog: (control) => (
                          <FormDialog
                            control={control}
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
                        ),
                      },
                      {
                        key: "moveWork",
                        label: t("move.open"),
                        allowed: inMenu.has("moveWork"),
                        dialog: (control) => <MoveDepartmentWork department={d.id} name={name(d)} active={d.active} targets={targets} control={control} />,
                      },
                      {
                        key: "switchOff",
                        label: t("switchOff"),
                        allowed: inMenu.has("switchOff"),
                        destructive: true,
                        confirm: t("switchOffConfirm"),
                        onSelect: () => void call({ endpoint: `/api/departments/${d.id}`, method: "PATCH", body: { active: false } }),
                      },
                      {
                        key: "switchOn",
                        label: t("switchOn"),
                        allowed: inMenu.has("switchOn"),
                        onSelect: () => void call({ endpoint: `/api/departments/${d.id}`, method: "PATCH", body: { active: true } }),
                      },
                    ]}
                  />
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  {d.members.length === 0 ? <p className="text-sm text-muted-foreground">{t("noMembers")}</p> : null}
                  <ul className="divide-y">
                    {d.members.map((m) => {
                      const row = new Set<string>(memberRowPlan({ makeHead: manage && !m.isHead, notHead: manage && m.isHead, remove: manage }).menu);
                      const member = `/api/departments/${d.id}/members/${m.userId}`;
                      return (
                        <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                          <span className="min-w-0 flex-1 font-medium">{m.name}</span>
                          {m.isHead ? (
                            <ToneBadge tone="active" className="gap-1">
                              <Crown className="size-3" />
                              {t("head")}
                            </ToneBadge>
                          ) : null}
                          <RowMenu
                            label={tc("moreFor", { name: m.name })}
                            items={[
                              {
                                key: "makeHead",
                                label: t("makeHead"),
                                allowed: row.has("makeHead"),
                                onSelect: () => void call({ endpoint: member, method: "PUT", body: { isHead: true } }),
                              },
                              {
                                key: "notHead",
                                label: t("notHead"),
                                allowed: row.has("notHead"),
                                onSelect: () => void call({ endpoint: member, method: "PUT", body: { isHead: false } }),
                              },
                              {
                                key: "remove",
                                label: t("remove"),
                                allowed: row.has("remove"),
                                destructive: true,
                                confirm: t("removeConfirm", { name: m.name }),
                                onSelect: () => void call({ endpoint: member, method: "DELETE" }),
                              },
                            ]}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {card.main === "addPerson" ? (
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
                  ) : manage && d.active ? (
                    <p className="text-xs text-muted-foreground">{t("everyoneIn")}</p>
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
