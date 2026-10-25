"use client";

import { Archive, ArchiveRestore, Languages, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "@/components/ui/toast";
import { openFilePage } from "@/app/(app)/projects/[id]/document-summary";
import { CircleAlert } from "@/components/animate-ui/icons/circle-alert";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Search } from "@/components/animate-ui/icons/search";
import { Send } from "@/components/animate-ui/icons/send";
import { BrandLoader, BrandMark } from "@/components/brand";
import { useConfirm } from "@/components/confirm-dialog";
import { ToneBadge } from "@/components/tone-badge";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { cn } from "@/lib/utils";

export type Lang = "ar" | "en";
type CaseType = "recommendation" | "action" | "finding" | "meeting" | "document";

export interface ChatRow {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
  orgName: string;
  orgNameAr: string | null;
  caseType: CaseType | null;
  keep: boolean;
  archivedAt: string | null;
  lastMessageAt: string;
  deleteOn: string | null;
}

interface Citation {
  chunkId: string | null;
  sourceType: string;
  sourceId: string;
  version: number;
  page?: number | null;
  label: string | null;
  available: boolean;
  newer?: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  lang: Lang;
  translation: { id: string; text: string; reviewed: boolean } | null;
  citations: Citation[];
}

export interface Chat extends Omit<ChatRow, "projectTitle"> {
  projectTitle: string;
  caseId: string | null;
  caseLabel: string | null;
  messages: ChatMessage[];
}

export interface NewChatCase {
  projectId: string;
  type: CaseType;
  id: string;
  label: string;
}

/** The answer in the interface language, from the cache or made once by the model. */
async function fetchTranslation(
  messageId: string,
  to: Lang,
): Promise<{ ok: boolean; limited?: boolean; translation?: { id: string; text: string; reviewed: boolean } }> {
  const res = await fetch("/api/translations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityType: "ai_message", entityId: messageId, field: "content", to }),
  }).catch(() => null);
  if (!res?.ok) return { ok: false, limited: res?.status === 429 };
  const data = (await res.json()) as { id: string | null; text: string; reviewed: boolean; original: boolean };
  return { ok: true, translation: !data.original && data.id ? { id: data.id, text: data.text, reviewed: data.reviewed } : undefined };
}

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

const rise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 380, damping: 32 },
} as const;

// ------------------------------------------------------------- the list

export function ChatList(props: {
  chats: ChatRow[];
  archived: ChatRow[] | null;
  filter: string;
  onFilter: (v: string) => void;
  selected: string | null;
  onOpen: (id: string) => void;
  onShowArchived: () => void;
  className?: string;
}) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const locale = useLocale();
  const [now] = useState(() => Date.now());
  const f = props.filter.trim().toLowerCase();
  const match = (c: ChatRow) => !f || c.title.toLowerCase().includes(f) || c.projectTitle.toLowerCase().includes(f);
  // Grouped by client and project, the group with the latest chat first.
  const groups = useMemo(() => {
    const out = new Map<string, { label: string; rows: ChatRow[] }>();
    for (const c of props.chats.filter(match)) {
      const client = locale === "ar" && c.orgNameAr ? c.orgNameAr : c.orgName;
      const key = c.projectId;
      if (!out.has(key)) out.set(key, { label: `${client} · ${c.projectTitle}`, rows: [] });
      out.get(key)!.rows.push(c);
    }
    return [...out.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chats, f, locale]);

  const row = (c: ChatRow) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => props.onOpen(c.id)}
        aria-current={props.selected === c.id ? "true" : undefined}
        className={cn(
          "grid w-full min-w-0 gap-0.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors hover:bg-muted",
          props.selected === c.id && "bg-muted",
        )}
      >
        <span className="truncate font-medium" dir="auto">
          {c.title || t("untitled")}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {c.caseType ? <span>{t(`cases.${c.caseType}`)}</span> : null}
          {c.caseType ? <span aria-hidden>·</span> : null}
          {/* A chat started after the list mounted is newer than `now`: "now", not "in 1 second". */}
          <span className="tabular-nums">{format.relativeTime(new Date(Math.min(Date.parse(c.lastMessageAt), now)), now)}</span>
          {c.keep ? <Pin className="size-3" aria-label={t("kept")} /> : null}
        </span>
      </button>
    </li>
  );

  return (
    <aside className={cn("flex min-h-0 flex-col gap-3 p-3", props.className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.filter}
          onChange={(e) => props.onFilter(e.target.value)}
          placeholder={t("searchChats")}
          aria-label={t("searchChats")}
          className="h-8 ps-8"
        />
      </div>
      <nav className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1" aria-label={t("chats")}>
        {groups.length === 0 ? <p className="px-2 text-xs text-muted-foreground">{f ? t("noMatch") : t("noChats")}</p> : null}
        {groups.map((g) => (
          <div key={g.label} className="space-y-1">
            <p className="truncate px-2 text-xs font-medium text-muted-foreground">{g.label}</p>
            <ul className="space-y-0.5">{g.rows.map(row)}</ul>
          </div>
        ))}
        <div className="space-y-1 border-t pt-2">
          <button
            type="button"
            onClick={props.onShowArchived}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Archive className="size-3.5" />
            {props.archived ? t("hideArchived") : t("showArchived")}
          </button>
          {props.archived ? (
            props.archived.length ? (
              <ul className="space-y-0.5 opacity-80">{props.archived.filter(match).map(row)}</ul>
            ) : (
              <p className="px-2 text-xs text-muted-foreground">{t("noArchived")}</p>
            )
          ) : null}
        </div>
      </nav>
    </aside>
  );
}

// ------------------------------------------------------------- headers

export function NewChatHeader({
  projects,
  draft,
  onChange,
  disabled,
}: {
  projects: { id: string; title: string; client: string }[];
  draft: { projectId: string; case: NewChatCase | null };
  onChange: (d: { projectId: string; case: NewChatCase | null }) => void;
  disabled: boolean;
}) {
  const t = useTranslations("assistant");
  const current = projects.find((p) => p.id === draft.projectId);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Label htmlFor="chat-project" className="shrink-0 text-muted-foreground">
        {t("project")}
      </Label>
      <Select
        value={draft.projectId}
        disabled={disabled}
        // A case belongs to its project: picking another project drops it.
        onValueChange={(v) => onChange({ projectId: v, case: draft.case?.projectId === v ? draft.case : null })}
      >
        <SelectTrigger id="chat-project" size="sm" className="min-w-56">
          <SelectValue>{current ? `${current.client} · ${current.title}` : null}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.client} · {p.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {draft.case ? (
        <Badge variant="outline" className="max-w-80 gap-1">
          <span className="text-muted-foreground">{t(`cases.${draft.case.type}`)}:</span>
          <span className="truncate" dir="auto">
            {draft.case.label}
          </span>
        </Badge>
      ) : null}
    </div>
  );
}

export function ChatHeader({
  chat,
  onPatch,
  onDelete,
}: {
  chat: Chat;
  onPatch: (c: { title?: string; keep?: boolean; archived?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("assistant");
  const tc = useTranslations("common");
  const format = useFormatter();
  const locale = useLocale();
  const [confirm, confirmDialog] = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const client = locale === "ar" && chat.orgNameAr ? chat.orgNameAr : chat.orgName;
  const deleteOn = chat.deleteOn ? new Date(`${chat.deleteOn}T00:00:00`) : null;
  const [now] = useState(() => Date.now());
  const soon = deleteOn ? deleteOn.getTime() - now < 7 * 86400_000 : false;

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
    if (!title) return;
    await onPatch({ title });
    setRenaming(false);
  }

  return (
    <div className="space-y-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <h2 className="truncate text-base font-semibold" dir="auto">
            {chat.title || t("untitled")}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{client}</Badge>
            <Badge variant="outline" asChild>
              <Link href={`/projects/${chat.projectId}`}>{chat.projectTitle}</Link>
            </Badge>
            {chat.caseType ? (
              <Badge variant="outline" className="max-w-72 gap-1">
                <span className="text-muted-foreground">{t(`cases.${chat.caseType}`)}:</span>
                <span className="truncate" dir="auto">
                  {chat.caseLabel ?? t("sourceGone")}
                </span>
              </Badge>
            ) : null}
            {chat.archivedAt ? <ToneBadge tone="neutral">{t("archivedBadge")}</ToneBadge> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setRenaming(true)} aria-label={t("rename")} title={t("rename")}>
            <Pencil />
          </Button>
          <Button
            variant={chat.keep ? "secondary" : "ghost"}
            size="icon"
            onClick={() => onPatch({ keep: !chat.keep })}
            aria-pressed={chat.keep}
            aria-label={chat.keep ? t("unkeep") : t("keep")}
            title={chat.keep ? t("unkeep") : t("keepHint")}
          >
            {chat.keep ? <PinOff /> : <Pin />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPatch({ archived: !chat.archivedAt })}
            aria-label={chat.archivedAt ? t("unarchive") : t("archive")}
            title={chat.archivedAt ? t("unarchive") : t("archive")}
          >
            {chat.archivedAt ? <ArchiveRestore /> : <Archive />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => (await confirm(t("deleteConfirm"))) && onDelete()}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {deleteOn ? (
        <p className={cn("text-xs", soon ? "text-warning" : "text-muted-foreground")}>
          {t(soon ? "deletesSoon" : "deletesOn", { date: format.dateTime(deleteOn, { dateStyle: "medium" }) })}
        </p>
      ) : null}
      {confirmDialog}
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <form onSubmit={rename} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("rename")}</DialogTitle>
            </DialogHeader>
            <Input name="title" defaultValue={chat.title} maxLength={120} required aria-label={t("rename")} dir="auto" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit">{tc("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------- messages

export function Thread({
  chat,
  loading,
  pending,
  failed,
  note,
}: {
  chat: Chat | null;
  loading: boolean;
  pending: string | null;
  failed: false | "error" | "limit";
  /** Under the empty chat's hint: what the assistant does not do. */
  note?: string;
}) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const messages = chat?.messages ?? [];
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  if (!messages.length && !pending) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia>{loading ? <BrandLoader className="size-8" /> : <BrandMark className="size-10 opacity-80" />}</EmptyMedia>
          {loading ? null : <EmptyDescription>{t("emptyThread")}</EmptyDescription>}
          {loading || !note ? null : <EmptyDescription className="text-xs">{note}</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={pending !== null} className="gap-5 p-4">
            {messages.map((m) => (
              <MessageScrollerItem key={m.id} scrollAnchor={m.id === lastAnswer}>
                {m.role === "user" ? (
                  <Question text={m.content} />
                ) : (
                  <AnswerView
                    // A new language or a newly kept translation starts the answer afresh.
                    key={`${m.id}:${locale}:${m.translation?.id ?? ""}`}
                    message={m}
                    projectId={chat!.projectId}
                    latest={m.id === lastAnswer}
                  />
                )}
              </MessageScrollerItem>
            ))}
            {pending ? (
              <MessageScrollerItem scrollAnchor>
                <motion.div {...rise} className="flex flex-col gap-5">
                  <Question text={pending} />
                  <Message>
                    <MessageAvatar className="size-8 self-start rounded-lg border bg-background">
                      <BrandLoader className="size-4" />
                    </MessageAvatar>
                    <MessageContent>
                      <Trace aria-label={t("asking")}>
                        <TraceLine status="running">
                          <TraceIcon>
                            <Search animate loop className="size-4" />
                          </TraceIcon>
                          <TraceTitle>{t("searching")}</TraceTitle>
                        </TraceLine>
                      </Trace>
                    </MessageContent>
                  </Message>
                </motion.div>
              </MessageScrollerItem>
            ) : null}
            {failed ? (
              <Bubble variant="destructive">
                <BubbleContent role="alert">{t(failed === "limit" ? "dailyLimit" : "error")}</BubbleContent>
              </Bubble>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={t("toLatest")} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function Question({ text }: { text: string }) {
  const t = useTranslations("assistant");
  // The person's own words: shown as written, never translated.
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end">
          <BubbleContent className="whitespace-pre-wrap" dir="auto">
            <span className="sr-only">{t("you")}: </span>
            {text}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * One answer. In the interface language it is shown as is. In the other
 * language: a kept translation is shown at once; the latest answer is
 * translated by itself; older ones stay folded until clicked.
 */
function AnswerView({ message, projectId, latest }: { message: ChatMessage; projectId: string; latest: boolean }) {
  const t = useTranslations("assistant");
  const tt = useTranslations("translation");
  const locale = useLocale() as Lang;
  const other = message.lang !== locale;
  const [translation, setTranslation] = useState(message.translation);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  // The latest answer translates by itself, once.
  const auto = other && latest && !message.translation;
  const [autoDone, setAutoDone] = useState(false);

  useEffect(() => {
    if (!auto) return;
    let live = true;
    void fetchTranslation(message.id, locale).then((r) => {
      if (!live) return;
      setAutoDone(true);
      if (r.ok && r.translation) setTranslation(r.translation);
      else if (!r.ok) setUnavailable(true);
    });
    return () => {
      live = false;
    };
  }, [auto, message.id, locale]);

  async function translate() {
    setBusy(true);
    setUnavailable(false);
    const r = await fetchTranslation(message.id, locale);
    setBusy(false);
    if (r.ok && r.translation) setTranslation(r.translation);
    if (!r.ok) {
      setUnavailable(true);
      if (r.limited) toast.error(tt("limited"));
    }
  }

  const working = busy || (auto && !autoDone && !translation);
  const folded = other && !translation && !latest && !unfolded && !working;
  const text = other && translation && !showOriginal ? translation.text : message.content;
  const langName = t(`languages.${message.lang}`);
  const notGrounded = message.citations.length === 0;

  return (
    <motion.div {...rise}>
      <Message>
        <MessageAvatar className="size-8 self-start rounded-lg border bg-background">
          <BrandMark className="size-4" />
        </MessageAvatar>
        <MessageContent className="min-w-0 flex-1">
          <span className="sr-only">{t("assistantName")}: </span>
          {folded ? (
            <button
              type="button"
              onClick={() => {
                setUnfolded(true);
                void translate();
              }}
              className="flex w-full max-w-2xl items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-start text-sm text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
            >
              <Badge variant="outline" className="shrink-0 uppercase">
                {message.lang}
              </Badge>
              <span className="min-w-0 flex-1 truncate" dir={message.lang === "ar" ? "rtl" : "ltr"} lang={message.lang}>
                {message.content}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs">
                <Languages className="size-3.5" />
                {t("folded", { lang: langName })}
              </span>
            </button>
          ) : (
            <>
              {working ? (
                <Trace aria-label={t("translating")}>
                  <TraceLine status="running">
                    <TraceIcon>
                      <Languages className="size-4" />
                    </TraceIcon>
                    <TraceTitle>{t("translating")}</TraceTitle>
                  </TraceLine>
                </Trace>
              ) : (
                <Bubble variant="outline" className="max-w-full">
                  {/* Model output is rendered as plain text, never as HTML (OWASP LLM05). */}
                  <BubbleContent
                    className="whitespace-pre-wrap"
                    dir={text === message.content ? (message.lang === "ar" ? "rtl" : "ltr") : "auto"}
                    lang={text === message.content ? message.lang : locale}
                  >
                    {text}
                  </BubbleContent>
                </Bubble>
              )}
              {other && !working ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {translation ? (
                    <>
                      <span>{translation.reviewed ? tt("reviewed") : tt("machine")}</span>
                      <button
                        type="button"
                        className="underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => setShowOriginal(!showOriginal)}
                      >
                        {showOriginal ? t("showTranslation") : tt("original")}
                      </button>
                    </>
                  ) : (
                    <>
                      {unavailable ? <span>{tt("unavailable")}</span> : null}
                      <button type="button" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline" onClick={translate}>
                        <Languages className="size-3" />
                        {tt("show")}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
          {notGrounded && !folded ? (
            <Marker className="text-xs text-warning">
              <MarkerIcon>
                <CircleAlert className="size-3.5" />
              </MarkerIcon>
              <MarkerContent>{t("notGrounded")}</MarkerContent>
            </Marker>
          ) : null}
          {message.citations.length && !folded ? <Sources citations={message.citations} projectId={projectId} /> : null}
        </MessageContent>
      </Message>
    </motion.div>
  );
}

function Sources({ citations, projectId }: { citations: Citation[]; projectId: string }) {
  const t = useTranslations("assistant");
  const chip = "inline-flex max-w-72 items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t("sources")}>
      <FileText className="size-3.5 text-muted-foreground" />
      {citations.map((c, i) => {
        const name = (
          <>
            <span className="truncate" dir="auto">
              {c.label}
            </span>
            {c.page ? <span className="text-muted-foreground tabular-nums">{t("page", { n: c.page })}</span> : null}
            {c.newer ? <span className="text-muted-foreground">· {t("newerVersion")}</span> : null}
          </>
        );
        if (!c.available) {
          return (
            <span key={i} className={cn(chip, "text-muted-foreground line-through")} title={t("sourceGoneHint")}>
              {t("sourceGone")}
            </span>
          );
        }
        if (c.sourceType === "document") {
          return (
            <button key={i} type="button" className={cn(chip, "hover:bg-muted")} onClick={() => openFilePage(c.sourceId, c.page ?? 1)}>
              {name}
            </button>
          );
        }
        const href =
          c.sourceType === "action"
            ? `/actions/${c.sourceId}`
            : c.sourceType === "meeting"
              ? `/meetings/${c.sourceId}`
              : c.sourceType === "recommendation"
                ? `/recommendations/${c.sourceId}`
                : c.sourceType === "kpi"
                  ? `/indicators/${c.sourceId}`
                  : `/projects/${projectId}`;
        return (
          <Link key={i} href={href} className={cn(chip, "hover:bg-muted")}>
            <span className="text-muted-foreground">{t(`cases.${c.sourceType as CaseType}`)}:</span>
            {name}
          </Link>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- composer

export function Composer({
  onAsk,
  busy,
  disabled,
  usage,
}: {
  onAsk: (q: string) => Promise<boolean>;
  busy: boolean;
  disabled: boolean;
  /** A client's questions today against the daily limit. */
  usage?: { used: number; limit: number } | null;
}) {
  const t = useTranslations("assistant");
  const [question, setQuestion] = useState("");
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || busy || disabled) return;
    setQuestion("");
    if (!(await onAsk(q))) setQuestion(q);
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }
  return (
    <form onSubmit={submit} className="border-t bg-background/60 p-3">
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs transition-[border-color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        )}
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          maxLength={2000}
          rows={1}
          autoFocus
          dir="auto"
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button type="submit" size="icon" disabled={busy || disabled || !question.trim()} aria-label={busy ? t("asking") : t("ask")}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : <Send animateOnHover className="rtl:-scale-x-100" />}
        </Button>
      </div>
      <p className="mt-1.5 px-1 text-xs text-muted-foreground">
        {t("enterHint")}
        {usage ? ` · ${t("clientUsage", { used: usage.used, limit: usage.limit })}` : null}
      </p>
    </form>
  );
}
