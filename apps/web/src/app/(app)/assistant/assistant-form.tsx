"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { CircleAlert } from "@/components/animate-ui/icons/circle-alert";
import { FileText } from "@/components/animate-ui/icons/file-text";
import { Search } from "@/components/animate-ui/icons/search";
import { Send } from "@/components/animate-ui/icons/send";
import { BrandLoader, BrandMark } from "@/components/brand";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
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
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";

interface Reply {
  answer: string;
  grounded: boolean;
  citations: { chunkId: string; sourceType: string; version: number }[];
}

interface Turn {
  id: number;
  question: string;
  reply?: Reply;
  error?: boolean;
}

const rise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 380, damping: 32 },
} as const;

/**
 * The conversation lives only in this page's memory; each question is an
 * independent, permission-checked query on the server.
 */
export function AssistantForm({ projects }: { projects: { id: string; title: string }[] }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  async function ask(e?: FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    setTurns((all) => [...all, { id, question: q }]);
    setQuestion("");
    setBusy(true);
    const settle = (patch: Partial<Turn>) => setTurns((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const res = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, question: q, language: locale === "ar" ? "ar" : "en" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      settle({ reply: (await res.json()) as Reply });
    } catch {
      settle({ error: true });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask();
    }
  }

  return (
    <div className="flex h-[min(42rem,calc(100svh-14rem))] min-h-[28rem] flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Label htmlFor="project" className="shrink-0 text-muted-foreground">
          {t("project")}
        </Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger id="project" size="sm" className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {turns.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia>
              <BrandMark className="size-10 opacity-80" />
            </EmptyMedia>
            <EmptyDescription>{t("emptyThread")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent aria-busy={busy} className="gap-6 p-4">
                {turns.map((turn) => (
                  <MessageScrollerItem key={turn.id} scrollAnchor>
                    <motion.div {...rise} className="flex flex-col gap-5">
                      <Message align="end">
                        <MessageContent>
                          <Bubble align="end">
                            <BubbleContent className="whitespace-pre-wrap">
                              <span className="sr-only">{t("you")}: </span>
                              {turn.question}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                      <Message>
                        <MessageAvatar className="size-8 self-start rounded-lg border bg-background">
                          {turn.reply || turn.error ? <BrandMark className="size-4" /> : <BrandLoader className="size-4" />}
                        </MessageAvatar>
                        <MessageContent className="min-w-0 flex-1">
                          <span className="sr-only">{t("assistantName")}: </span>
                          {turn.reply ? (
                            <Answer reply={turn.reply} />
                          ) : turn.error ? (
                            <Bubble variant="destructive">
                              <BubbleContent role="alert">{t("error")}</BubbleContent>
                            </Bubble>
                          ) : (
                            <Trace aria-label={t("asking")}>
                              <TraceLine status="running">
                                <TraceIcon>
                                  <Search animate loop className="size-4" />
                                </TraceIcon>
                                <TraceTitle>{t("searching")}</TraceTitle>
                              </TraceLine>
                            </Trace>
                          )}
                        </MessageContent>
                      </Message>
                    </motion.div>
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton aria-label={t("toLatest")} />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <form onSubmit={ask} className="border-t bg-background/60 p-3">
        <div className={cn("flex items-end gap-2 rounded-xl border bg-background p-2 shadow-xs transition-[border-color,box-shadow]", "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30")}>
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            maxLength={2000}
            rows={1}
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label={busy ? t("asking") : t("ask")}>
            {busy ? <BrandLoader tone="current" className="size-4" /> : <Send animateOnHover className="rtl:-scale-x-100" />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{t("enterHint")}</p>
      </form>
    </div>
  );
}

/** One answer: the text, a note when no permitted source backs it, and the sources it cites. */
function Answer({ reply }: { reply: Reply }) {
  const t = useTranslations("assistant");
  return (
    <motion.div {...rise} className="flex flex-col gap-2">
      <Bubble variant="outline" className="max-w-full">
        {/* Model output is rendered as plain text, never as HTML (OWASP LLM05). */}
        <BubbleContent className="whitespace-pre-wrap">{reply.answer}</BubbleContent>
      </Bubble>
      {!reply.grounded ? (
        <Marker className="text-xs text-warning">
          <MarkerIcon>
            <CircleAlert animateOnView className="size-3.5" />
          </MarkerIcon>
          <MarkerContent>{t("notGrounded")}</MarkerContent>
        </Marker>
      ) : null}
      {reply.citations.length ? (
        <Trace>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceIcon>
                  <FileText className="size-4" />
                </TraceIcon>
                <TraceTitle>{t("sources")}</TraceTitle>
                <TraceDescription>{reply.citations.length}</TraceDescription>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <ol className="flex flex-col gap-1 text-xs">
                {reply.citations.map((c, i) => (
                  <li key={c.chunkId} className="tabular-nums">
                    [{i + 1}] {c.sourceType} v{c.version}
                  </li>
                ))}
              </ol>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      ) : null}
    </motion.div>
  );
}
