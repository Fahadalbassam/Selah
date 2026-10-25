"use client";

import { AtSign } from "lucide-react";
import { Send } from "@/components/animate-ui/icons/send";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ASK_EVENT, THREAD_ANCHOR } from "@/lib/help";

interface Person {
  id: string;
  name: string;
  side: "firm" | "client";
}

interface Comment {
  id: string;
  body: string;
  authorName: string;
  mine: boolean;
  removedAt: Date | string | null;
  createdAt: Date | string;
  mentioned: { id: string; name: string | null; you: boolean }[];
  can: { remove: boolean };
}

/** Maps a data rule's words (or the route's) to a message key under action.thread.errors. */
function threadError(message: string | undefined) {
  const m = message ?? "";
  if (m.includes("mentions")) return "mentions";
  if (m.includes("needs text")) return "empty";
  if (m.includes("already removed")) return "removed";
  return "cannot";
}

/**
 * The two-way thread on an action (F11): the firm and the client talk about
 * the work where it is recorded. Everyone who can see the action reads it;
 * a mention tells someone who can see it too.
 */
export function CommentThread({
  actionId,
  comments,
  people,
  canWrite,
  firmView,
  askMention,
}: {
  actionId: string;
  comments: Comment[];
  people: Person[];
  canWrite: boolean;
  firmView: boolean;
  /** Client side (F13): who "Ask your consultant" mentions, the client's lead when they can see the action. */
  askMention?: string | null;
}) {
  const t = useTranslations("action.thread");
  const format = useFormatter();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();
  const when = (d: Date | string) => format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short" });
  const byId = new Map(people.map((p) => [p.id, p]));
  const box = useRef<HTMLTextAreaElement>(null);

  // "Ask your consultant" in the page header brings the reader here, with the lead mentioned.
  useEffect(() => {
    const ask = () => {
      const lead = askMention;
      if (lead && people.some((p) => p.id === lead)) setMentions((m) => (m.includes(lead) ? m : [...m, lead]));
      box.current?.scrollIntoView({ block: "center" });
      box.current?.focus({ preventScroll: true });
    };
    window.addEventListener(ASK_EVENT, ask);
    return () => window.removeEventListener(ASK_EVENT, ask);
  }, [askMention, people]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/actions/${actionId}/comments`, "POST", { body, mentions });
    setBusy(false);
    if (!r.ok) return void setError(threadError(r.message));
    setBody("");
    setMentions([]);
    toast.success(t("posted"));
    router.refresh();
  }

  async function remove(id: string) {
    if (!(await confirm(t("removeQuestion")))) return;
    const r = await callApi(`/api/action-comments/${id}/remove`, "POST");
    if (!r.ok) return void toast.error(t(`errors.${threadError(r.message)}`));
    toast.success(t("removed"));
    router.refresh();
  }

  const toggle = (id: string, on: boolean) => setMentions((m) => (on ? [...m, id] : m.filter((x) => x !== id)));

  return (
    <Card id={THREAD_ANCHOR} className="scroll-mt-16 gap-4 py-5 shadow-xs">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{firmView ? t("hintFirm") : t("hintClient")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-5">
        {comments.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        <ol className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p>
                  <span className="font-medium">{c.mine ? t("you") : c.authorName}</span>
                  <span className="ms-2 text-xs text-muted-foreground tabular-nums">{when(c.createdAt)}</span>
                </p>
                {c.can.remove ? (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => void remove(c.id)} aria-label={t("remove")} title={t("remove")}>
                    <X animateOnHover className="size-4" />
                  </Button>
                ) : null}
              </div>
              {c.removedAt ? (
                <p className="text-muted-foreground italic">{t("removedMarker", { date: when(c.removedAt) })}</p>
              ) : (
                <>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {c.body}
                  </p>
                  {c.mentioned.length ? (
                    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <AtSign className="size-3" />
                      {c.mentioned.map((m) => (
                        <Badge key={m.id} variant={m.you ? "secondary" : "outline"} className="font-normal">
                          {m.you ? t("you") : (m.name ?? t("someone"))}
                        </Badge>
                      ))}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ol>

        {canWrite ? (
          <form onSubmit={submit} className="grid gap-3 border-t pt-4">
            <Label htmlFor={`thread-${actionId}`} className="sr-only">
              {t("label")}
            </Label>
            <Textarea
              ref={box}
              id={`thread-${actionId}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={3}
              maxLength={8000}
              dir="auto"
              placeholder={t("placeholder")}
            />
            {mentions.length ? (
              <div className="flex flex-wrap items-center gap-1">
                {mentions.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 font-normal">
                    {byId.get(id)?.name}
                    <button type="button" onClick={() => toggle(id, false)} aria-label={t("unmention", { name: byId.get(id)?.name ?? "" })}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`errors.${error}`)}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={people.length === 0}>
                    <AtSign className="size-4" />
                    {t("mention")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-2">
                  <p className="px-2 pb-2 text-xs text-muted-foreground">{t("mentionHint")}</p>
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {people.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                          <Checkbox checked={mentions.includes(p.id)} onCheckedChange={(on) => toggle(p.id, on === true)} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{t(`sides.${p.side}`)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
              <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                {busy ? <BrandLoader tone="current" className="size-4" /> : <Send animateOnHover className="size-4 rtl:-scale-x-100" />}
                {busy ? t("posting") : t("post")}
              </Button>
            </div>
          </form>
        ) : null}
        {dialog}
      </CardContent>
    </Card>
  );
}
