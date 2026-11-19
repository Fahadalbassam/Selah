"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Plus } from "@/components/animate-ui/icons/plus";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The one "New project" button on Projects (October review, item 3): the
 * first field is the kind. A project for a client goes to that client (only
 * the clients this person may start a project for are offered, from the
 * server) and is a draft until an engagement covers it; an internal project
 * is the firm's own. The routes check who may, as before.
 */
export function NewProjectDialog({ clients, internal }: { clients: { id: string; name: string }[]; internal: boolean }) {
  const t = useTranslations("projects.new");
  const tc = useTranslations("common");
  const router = useRouter();
  const kinds = [...(clients.length ? (["client"] as const) : []), ...(internal ? (["internal"] as const) : [])];
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"client" | "internal">(kinds[0] ?? "internal");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!kinds.length) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (kind === "client" && !clientId) return setError(t("pickClient"));
    setBusy(true);
    setError(null);
    const r =
      kind === "client"
        ? await callApi(`/api/clients/${clientId}/projects`, "POST", { title, ...(description ? { description } : {}) })
        : await callApi("/api/projects/internal", "POST", { title, ...(description ? { description } : {}) });
    setBusy(false);
    if (!r.ok) return setError(tc(`errors.${r.error}`));
    setOpen(false);
    const id = (r.data as { id?: string } | null)?.id;
    router.push(id ? `/projects/${id}` : "/projects");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("button")}</DialogTitle>
            <DialogDescription>{t(kind === "client" ? "clientHint" : "internalHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="np-kind">{t("kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "client" | "internal")}>
              <SelectTrigger id="np-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "client" ? (
            <div className="grid gap-2">
              <Label htmlFor="np-client">{t("client")}</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="np-client" className="w-full">
                  <SelectValue placeholder={t("pickClient")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <bdi>{c.name}</bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="np-title">{t("title")}</Label>
            <Input id="np-title" name="title" required minLength={2} maxLength={200} dir="auto" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-description">{t("description")}</Label>
            <Textarea id="np-description" name="description" maxLength={2000} dir="auto" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
