"use client";

import { Loader2, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Reply {
  answer: string;
  grounded: boolean;
  citations: { chunkId: string; sourceType: string; version: number }[];
}

export function AssistantForm({ projects }: { projects: { id: string; title: string }[] }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(false);
    setReply(null);
    try {
      const res = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, question, language: locale === "ar" ? "ar" : "en" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setReply(await res.json());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={ask} className="space-y-4">
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="project">{t("project")}</Label>
        <select
          id="project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("placeholder")} maxLength={2000} rows={3} />
      <Button type="submit" disabled={busy || !question.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
        {busy ? t("asking") : t("ask")}
      </Button>
      {error ? <p className="text-sm text-destructive">{t("error")}</p> : null}
      {reply ? (
        <Card className="py-4 shadow-xs">
          <CardContent className="space-y-3 px-5">
            {/* Model output is rendered as plain text, never as HTML (OWASP LLM05). */}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.answer}</p>
            {reply.citations.length ? (
              <div className="text-xs text-muted-foreground">
                {t("sources")}: {reply.citations.map((c, i) => `[${i + 1}] ${c.sourceType} v${c.version}`).join(" · ")}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </form>
  );
}
