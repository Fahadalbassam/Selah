"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { callApi } from "@/components/form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { engagementError } from "@/lib/engagement";

const NONE = "none";

/**
 * Files the action under one of the client's departments, or none. When
 * departments are on, only that department's people (and the client's
 * admins, the firm and the owner) see it.
 */
export function DepartmentPicker(props: {
  actionId: string;
  value: string | null;
  departments: { id: string; nameAr: string; nameEn: string | null; active: boolean }[];
}) {
  const t = useTranslations("engagement");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // A switched-off department stays shown while the action is filed under it.
  const options = props.departments.filter((d) => d.active || d.id === props.value);

  async function change(v: string) {
    setBusy(true);
    const r = await callApi(`/api/actions/${props.actionId}`, "PATCH", { departmentId: v === NONE ? null : v });
    setBusy(false);
    if (!r.ok) {
      const key = engagementError(r.message);
      return toast.error(key && t.has(`errors.${key}`) ? t(`errors.${key}`) : tc(`errors.${r.error}`));
    }
    toast.success(tc("saved"));
    router.refresh();
  }

  return (
    <Select value={props.value ?? NONE} onValueChange={(v) => void change(v)} disabled={busy}>
      <SelectTrigger size="sm" className="w-full" aria-label={t("departments.fileUnder")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("departments.none")}</SelectItem>
        {options.map((d) => (
          <SelectItem key={d.id} value={d.id} disabled={!d.active}>
            {ar ? d.nameAr : (d.nameEn ?? d.nameAr)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
