"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { CircleCheck } from "@/components/animate-ui/icons/circle-check";
import { Upload } from "@/components/animate-ui/icons/upload";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/upload-rules";

/** Sends one file at a time through the link; the server checks, scans and files it. */
export function UploadForm({ token }: { token: string }) {
  const t = useTranslations("uploadLink");
  const tf = useTranslations("fileActions");
  const tc = useTranslations("common");
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // File names sent from this page, newest last.
  const [sent, setSent] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/upload/${token}`, { method: "POST", body: data });
      if (res.ok) {
        setSent((s) => [...s, file.name]);
        form.current?.reset();
        return;
      }
      const m = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "";
      if (res.status === 404 || res.status === 429) setClosed(true);
      setError(
        res.status === 404
          ? t("closed")
          : res.status === 429
            ? t("full")
            : res.status === 503
              ? tf("errors.scanner")
              : m.includes("infected")
                ? tf("errors.infected")
                : m.includes("too large")
                  ? tf("errors.tooLarge")
                  : m.includes("rejected")
                    ? tf("errors.type")
                    : tc("errors.generic"),
      );
    } catch {
      setError(tc("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {sent.length ? (
        <div role="status" className="space-y-2 rounded-md border px-3 py-2 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck animateOnView className="size-4" />
            {t("received", { n: sent.length })}
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {sent.map((name, i) => (
              <li key={`${name}-${i}`}>
                <bdi>{name}</bdi>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {closed ? null : (
        <form ref={form} onSubmit={submit} className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="upload-file">{sent.length ? t("another") : t("file")}</Label>
            <Input id="upload-file" name="file" type="file" accept={ACCEPTED_EXTENSIONS} required />
            <p className="text-xs text-muted-foreground">
              {t("rules", { types: ACCEPTED_EXTENSIONS.replaceAll(",", " "), mb: MAX_UPLOAD_BYTES / 1024 / 1024 })}
            </p>
          </div>
          <Button type="submit" disabled={busy} className="justify-self-start">
            {busy ? <BrandLoader tone="current" className="size-4" /> : <Upload />}
            {busy ? t("sending") : t("send")}
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
