"use client";

import { CircleAlert, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { BrandLoader, BrandMark } from "@/components/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

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
    <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
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

      <div className="flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 ? (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 text-center">
            <BrandMark className="size-10 opacity-80" />
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyThread")}</p>
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {turns.map((turn) => (
            <motion.div key={turn.id} {...rise} className="space-y-5">
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
                  <span className="sr-only">{t("you")}: </span>
                  {turn.question}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Avatar className="size-8 rounded-lg border bg-background">
                  <AvatarFallback className="rounded-lg bg-background">
                    {turn.reply || turn.error ? <BrandMark className="size-4" /> : <BrandLoader className="size-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="sr-only">{t("assistantName")}: </span>
                  {turn.reply ? (
                    <motion.div {...rise} className="space-y-3 rounded-2xl rounded-ss-sm border bg-background px-4 py-3">
                      {/* Model output is rendered as plain text, never as HTML (OWASP LLM05). */}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.reply.answer}</p>
                      {!turn.reply.grounded ? (
                        <p className="flex items-center gap-1.5 text-xs text-warning">
                          <CircleAlert className="size-3.5" />
                          {t("notGrounded")}
                        </p>
                      ) : null}
                      {turn.reply.citations.length ? (
                        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2 text-xs text-muted-foreground">
                          <span>{t("sources")}:</span>
                          {turn.reply.citations.map((c, i) => (
                            <span key={c.chunkId} className="rounded-md border bg-muted/50 px-1.5 py-0.5 tabular-nums">
                              [{i + 1}] {c.sourceType} v{c.version}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </motion.div>
                  ) : turn.error ? (
                    <p role="alert" className="rounded-2xl rounded-ss-sm border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {t("error")}
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-2xl rounded-ss-sm border bg-background px-4 py-3" aria-label={t("asking")}>
                      <Skeleton className="h-3 w-4/5" />
                      <Skeleton className="h-3 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={end} />
      </div>

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
            {busy ? <BrandLoader tone="current" className="size-4" /> : <Send className="rtl:-scale-x-100" />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{t("enterHint")}</p>
      </form>
    </div>
  );
}
