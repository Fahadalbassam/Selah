"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Option = { code: string; nameAr: string; nameEn: string };
type Lang = "ar" | "en";
const LANGS: Lang[] = ["ar", "en"];

export interface ExpertiseData {
  consultants: {
    userId: string;
    name: string;
    email: string;
    profile: { languages: string[]; acceptingNewClients: boolean; services: string[]; sectors: string[] } | null;
    canEdit: "all" | "own" | null;
  }[];
  services: Option[];
  sectors: Option[];
}

/** Every consultant's declared expertise, sorted by name. Used to suggest a lead, never to rate anyone. */
export function ExpertiseTable({ data, me }: { data: ExpertiseData; me: string }) {
  const t = useTranslations("expertise");
  const ar = useLocale() === "ar";
  const [editing, setEditing] = useState<ExpertiseData["consultants"][number] | null>(null);
  const label = (list: Option[], code: string) => {
    const x = list.find((o) => o.code === code);
    return x ? (ar ? x.nameAr : x.nameEn) : code;
  };
  const chips = (list: Option[], codes: string[]) =>
    codes.length ? (
      <div className="flex flex-wrap gap-1">
        {codes.map((c) => (
          <ToneBadge key={c} tone="open">
            {label(list, c)}
          </ToneBadge>
        ))}
      </div>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("services")}</TableHead>
              <TableHead>{t("sectors")}</TableHead>
              <TableHead>{t("languages")}</TableHead>
              <TableHead>{t("availability")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("edit")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.consultants.map((c) => (
              <TableRow key={c.userId}>
                <TableCell className="align-top">
                  <p className="flex items-center gap-2 font-medium">
                    <span>{c.name}</span>
                    {c.userId === me ? <span className="text-xs font-normal text-muted-foreground">{t("you")}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {c.email}
                  </p>
                </TableCell>
                {c.profile ? (
                  <>
                    <TableCell className="max-w-72 align-top whitespace-normal">
                      {chips(data.services, c.profile.services)}
                    </TableCell>
                    <TableCell className="max-w-56 align-top whitespace-normal">
                      {chips(data.sectors, c.profile.sectors)}
                    </TableCell>
                    <TableCell className="align-top">
                      {c.profile.languages.map((l) => t(`lang.${l as Lang}`)).join(ar ? "، " : ", ")}
                    </TableCell>
                    <TableCell className="align-top">
                      <ToneBadge tone={c.profile.acceptingNewClients ? "neutral" : "waiting"}>
                        {c.profile.acceptingNewClients ? t("accepting") : t("notAccepting")}
                      </ToneBadge>
                    </TableCell>
                  </>
                ) : (
                  <TableCell colSpan={4} className="align-top text-muted-foreground">
                    {c.canEdit === "all" ? t("notSetUp") : t("notSetUpAsk")}
                  </TableCell>
                )}
                <TableCell className="align-top">
                  {c.canEdit ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={c.profile ? t("editFor", { name: c.name }) : t("setUpFor", { name: c.name })}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? <ProfileDialog key={editing.userId} person={editing} data={data} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ProfileDialog({
  person,
  data,
  onClose,
}: {
  person: ExpertiseData["consultants"][number];
  data: ExpertiseData;
  onClose: () => void;
}) {
  const t = useTranslations("expertise");
  const tc = useTranslations("common");
  const ar = useLocale() === "ar";
  const router = useRouter();
  const all = person.canEdit === "all";
  const [languages, setLanguages] = useState<Lang[]>((person.profile?.languages as Lang[] | undefined) ?? ["ar"]);
  const [accepting, setAccepting] = useState(person.profile?.acceptingNewClients ?? true);
  const [services, setServices] = useState<string[]>(person.profile?.services ?? []);
  const [sectors, setSectors] = useState<string[]>(person.profile?.sectors ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flip = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!languages.length) return setError(t("needLanguage"));
    setBusy(true);
    setError(null);
    const body = all
      ? { languages, acceptingNewClients: accepting, services, sectors }
      : { languages, acceptingNewClients: accepting };
    const r = await callApi(`/api/consultants/${person.userId}/profile`, "PUT", body);
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    toast.success(tc("saved"));
    onClose();
    router.refresh();
  }

  const group = (id: string, title: string, list: Option[], value: string[], set: (v: string[]) => void) => (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {list.map((o) => (
          <label key={o.code} htmlFor={`${id}-${o.code}`} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${id}-${o.code}`}
              checked={value.includes(o.code)}
              onCheckedChange={(v) => set(flip(value, o.code, v === true))}
            />
            {ar ? o.nameAr : o.nameEn}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {person.profile ? t("editFor", { name: person.name }) : t("setUpFor", { name: person.name })}
            </DialogTitle>
            <DialogDescription>{all ? t("dialogHint") : t("dialogHintOwn")}</DialogDescription>
          </DialogHeader>
          {all ? group("svc", t("services"), data.services, services, setServices) : null}
          {all ? group("sec", t("sectors"), data.sectors, sectors, setSectors) : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("languages")}</legend>
            <div className="flex gap-6">
              {LANGS.map((l) => (
                <label key={l} htmlFor={`lang-${l}`} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`lang-${l}`}
                    checked={languages.includes(l)}
                    onCheckedChange={(v) => setLanguages(flip(languages, l, v === true))}
                  />
                  {t(`lang.${l}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <Label htmlFor="accepting">{t("availability")}</Label>
              <p className="text-sm text-muted-foreground">{t("availabilityHint")}</p>
            </div>
            <Switch id="accepting" checked={accepting} onCheckedChange={setAccepting} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
