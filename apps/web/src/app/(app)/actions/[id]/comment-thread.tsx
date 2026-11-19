"use client";

import { AtSign } from "lucide-react";
import { Send } from "@/components/animate-ui/icons/send";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { callApi } from "@/components/form-dialog";
import { IconTip } from "@/components/hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { panelVoice } from "@/lib/engagement";
import { typedDir } from "@/lib/utils";
import { ASK_EVENT, THREAD_ANCHOR } from "@/lib/help";
import { ReceivedFields, useReceived } from "./action-panel";

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

/** A progress note on the work, shown in the conversation (page audit 4.5, block 6). */
export interface ProgressNote {
  id: string;
  at: Date | string;
  who: string | null;
  body: ReactNode;
  /** On a client the firm runs: how and when the client told the firm. */
  received: string | null;
}

/**
 * The one conversation on an action (F11; page audit 4.5, block 6): the firm
 * and the client talk about the work where it is recorded, and the progress
 * notes are part of it, so there is one box. Everyone who can see the action
 * reads it; a mention tells someone who can see it too. Whoever moves the
 * work may mark what they write as a progress note (it counts as activity on
 * the action); on a client the firm runs, the firm records the client's
 * progress here, with how and when the client sent it.
 */
export function CommentThread({
  actionId,
  comments,
  people,
  canWrite,
  firmView,
  firmRun = false,
  askMention,
  notes = [],
  progress,
}: {
  actionId: string;
  notes?: ProgressNote[];
  /** May post a progress note (progress_update.create), and whether the firm records it for the client. */
  progress?: { recordFor: boolean } | null;
  comments: Comment[];
  people: Person[];
  canWrite: boolean;
  firmView: boolean;
  /** A client the firm runs (no accounts): nobody at the client reads the thread (N24). */
  firmRun?: boolean;
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
  const [asNote, setAsNote] = useState(false);
  const received = useReceived(!!progress?.recordFor && asNote);

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
    if (asNote && !received.ready) return void setError("received");
    setBusy(true);
    setError(null);
    const r = asNote
      ? await callApi(`/api/actions/${actionId}/updates`, "POST", { body: body.trim(), ...received.payload })
      : await callApi(`/api/actions/${actionId}/comments`, "POST", { body, mentions });
    setBusy(false);
    if (!r.ok) return void setError(asNote && /how and when/.test(r.message ?? "") ? "received" : threadError(r.message));
    setBody("");
    setMentions([]);
    setAsNote(false);
    received.reset();
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
        <CardDescription>{t(`hint${panelVoice(firmView, firmRun)}`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-5">
        {comments.length === 0 && notes.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        <ol className="space-y-4">
          {[
            ...comments.map((c) => ({ at: new Date(c.createdAt).getTime(), c, n: null })),
            ...notes.map((n) => ({ at: new Date(n.at).getTime(), c: null, n })),
          ]
            .sort((a, b) => a.at - b.at)
            .map(({ c, n }) =>
              n ? (
                <li key={`n-${n.id}`} className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{n.who ?? t("someone")}</span>
                    <Badge variant="outline" className="ms-2 font-normal">
                      {t("progressNote")}
                    </Badge>
                    <span className="ms-2 text-xs text-muted-foreground tabular-nums">{when(n.at)}</span>
                  </p>
                  {n.received ? <p className="text-xs text-muted-foreground">{n.received}</p> : null}
                  <div>{n.body}</div>
                </li>
              ) : c ? (
            <li key={c.id} className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p>
                  <span className="font-medium">{c.mine ? t("you") : c.authorName}</span>
                  <span className="ms-2 text-xs text-muted-foreground tabular-nums">{when(c.createdAt)}</span>
                </p>
                {c.can.remove ? (
                  <IconTip name="removeComment">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void remove(c.id)} aria-label={t("remove")}>
                      <X animateOnHover className="size-4" />
                    </Button>
                  </IconTip>
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
              ) : null,
            )}
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
              dir={typedDir(body)}
              placeholder={t("placeholder")}
            />
            {progress ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={asNote} onCheckedChange={(on) => setAsNote(on === true)} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block">{progress.recordFor ? t("asRecorded") : t("asNote")}</span>
                  <span className="block text-xs text-muted-foreground">{progress.recordFor ? t("asRecordedHint") : t("asNoteHint")}</span>
                </span>
              </label>
            ) : null}
            {asNote && progress?.recordFor ? <ReceivedFields idPrefix="up" {...received} /> : null}
            {mentions.length && !asNote ? (
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
                  <Button type="button" variant="outline" size="sm" disabled={people.length === 0 || asNote}>
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
                          {/* A client reader's own side is "your company", never "the client". */}
                          <span className="text-xs text-muted-foreground">{t(`sides.${p.side === "client" && !firmView ? "yours" : p.side}`)}</span>
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
