"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Download } from "@/components/animate-ui/icons/download";
import { ExportButton } from "@/components/export-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** One choice of the dialog: a row of labelled radio buttons. */
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{label}</p>
      <RadioGroup value={value} onValueChange={onChange} aria-label={label} className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <Label key={o.value} className="flex items-center gap-2 text-sm font-normal">
            <RadioGroupItem value={o.value} />
            <span dir="auto">{o.label}</span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * "Download PDF" on the Structure tab: the reader picks the paper (A3 or A4
 * landscape), how many levels, and, when they see any names, with or
 * without them. The server makes the file from what this reader may see; a
 * copy without names drops every name.
 */
export function StructurePdfButton({
  endpoint,
  version,
  levels,
  depth,
  names,
}: {
  /** The PDF route of this client's structure. */
  endpoint: string;
  /** The version shown ("draft", an id), or null for the current one. */
  version: string | null;
  levels: number[];
  /** The depth shown on the screen, the dialog's starting choice. */
  depth: number | null;
  /** Whether the reader sees any names, so may print them. */
  names: boolean;
}) {
  const t = useTranslations("orgChart");
  const [size, setSize] = useState("a3");
  const [level, setLevel] = useState(depth === null ? "all" : String(depth));
  const [withNames, setWithNames] = useState(names ? "1" : "0");
  const query = new URLSearchParams({ size, names: names ? withNames : "0" });
  if (version) query.set("version", version);
  if (level !== "all") query.set("depth", level);
  const upTo = levels.slice(0, -1);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Download />
          {t("pdf.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pdf.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("pdf.dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Choice
            label={t("pdf.paper")}
            value={size}
            onChange={setSize}
            options={[
              { value: "a3", label: t("pdf.a3") },
              { value: "a4", label: t("pdf.a4") },
            ]}
          />
          {upTo.length ? (
            <Choice
              label={t("pdf.levels")}
              value={level}
              onChange={setLevel}
              options={[...upTo.map((n) => ({ value: String(n), label: t("depth.upTo", { n }) })), { value: "all", label: t("depth.all") }]}
            />
          ) : null}
          {names ? (
            <Choice
              label={t("pdf.names")}
              value={withNames}
              onChange={setWithNames}
              options={[
                { value: "1", label: t("pdf.withNames") },
                { value: "0", label: t("pdf.withoutNames") },
              ]}
            />
          ) : null}
        </div>
        <DialogFooter>
          <ExportButton endpoint={`${endpoint}?${query}`} label={t("pdf.download")} variant="default" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
