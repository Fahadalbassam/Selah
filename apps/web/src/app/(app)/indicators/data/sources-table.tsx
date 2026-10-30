"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { callApi } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";

interface Ref {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
  code: string | null;
  active: boolean;
  feedOn?: boolean;
  unit: string;
}

/**
 * Each indicator's code (what the client's files and systems call it) and,
 * when the client is connected, whether connections may fill it. Codes make
 * matching exact; without one, an indicator is matched by its name.
 */
export function SourcesTable({ indicators, connected, canChooseFlow }: { indicators: Ref[]; connected: boolean; canChooseFlow: boolean }) {
  const t = useTranslations("indicatorData.sources");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(indicators.map((k) => [k.id, k.code ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);

  async function patch(id: string, body: { code?: string | null; feedOn?: boolean }) {
    setBusy(id);
    const r = await callApi(`/api/indicators/${id}/source`, "PATCH", body);
    setBusy(null);
    if (!r.ok) return void toast.error(r.message?.includes("code taken") ? t("codeTaken") : t("failed"));
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{connected ? t("hintConnected") : t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("indicator")}</TableHead>
              <TableHead>{t("code")}</TableHead>
              {connected ? <TableHead>{t("flows")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {indicators
              .filter((k) => k.active)
              .map((k) => {
                const code = codes[k.id] ?? "";
                const changed = code.trim().toLowerCase() !== (k.code ?? "");
                return (
                  <TableRow key={k.id}>
                    <TableCell dir="auto">
                      {(ar ? (k.nameAr ?? k.nameEn) : (k.nameEn ?? k.nameAr)) ?? ""} <span className="text-xs text-muted-foreground">({k.unit})</span>
                    </TableCell>
                    <TableCell>
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (code.trim() && !/^[a-z0-9][a-z0-9_.-]{0,39}$/i.test(code.trim())) return void toast.error(t("codeShape"));
                          void patch(k.id, { code: code.trim() || null });
                        }}
                      >
                        <Input
                          value={code}
                          onChange={(e) => setCodes({ ...codes, [k.id]: e.target.value })}
                          dir="ltr"
                          maxLength={40}
                          placeholder={t("codePlaceholder")}
                          aria-label={t("code")}
                          className="h-8 w-44 font-mono text-xs"
                        />
                        {changed ? (
                          <Button size="sm" variant="outline" type="submit" disabled={busy === k.id}>
                            {t("save")}
                          </Button>
                        ) : null}
                      </form>
                    </TableCell>
                    {connected ? (
                      <TableCell>
                        {canChooseFlow ? (
                          <Switch
                            checked={!!k.feedOn}
                            disabled={busy === k.id}
                            onCheckedChange={(v) => void patch(k.id, { feedOn: v })}
                            aria-label={t("flows")}
                          />
                        ) : (
                          <Badge variant="outline">{k.feedOn ? t("on") : t("off")}</Badge>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
