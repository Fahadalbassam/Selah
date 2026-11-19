"use client";

// "@" in the assistant's box (docs/assistant.md, "Attaching a file"): the
// picker of files the person can already open, and the chips of the files
// attached to the question. What the assistant can read of each is the
// server's word (status), said on the chip; the server checks it again when
// the question is asked.
import { Paperclip, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandLoader } from "@/components/brand";
import type { AttachStatus } from "@/lib/assistant-attach";
import { cn } from "@/lib/utils";

export interface AttachedFile {
  id: string;
  title: string;
  /** In a chat across projects: "Client · Project". */
  place?: string | null;
  status: AttachStatus;
}

/** The files attached to the question, each removable, each saying when the assistant can't use it. */
export function AttachChips({ files, onRemove }: { files: AttachedFile[]; onRemove: (id: string) => void }) {
  const t = useTranslations("assistant.attach");
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-1 pb-2" aria-label={t("chipsLabel")}>
      {files.map((f) => {
        const problem = f.status !== "ok";
        return (
          <li
            key={f.id}
            data-status={f.status}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 py-0.5 ps-2 pe-0.5 text-xs",
              problem && "border-dashed text-muted-foreground",
            )}
          >
            <Paperclip className="size-3 shrink-0" aria-hidden />
            <span className={cn("max-w-48 truncate", problem && "line-through")} dir="auto" title={f.title}>
              {f.title}
            </span>
            {problem ? <span className="text-warning">{t(`status.${f.status}`)}</span> : null}
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={t("remove", { title: f.title })}
              title={t("remove", { title: f.title })}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The list the "@" opens above the box: the files found, the one the arrows are on, or why there is none. */
export function FilePicker({
  id,
  results,
  active,
  loading,
  full,
  onPick,
  onHover,
}: {
  id: string;
  results: AttachedFile[] | null;
  active: number;
  loading: boolean;
  /** The question already carries MAX_ATTACHMENTS files. */
  full: boolean;
  onPick: (f: AttachedFile) => void;
  onHover: (i: number) => void;
}) {
  const t = useTranslations("assistant.attach");
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
      <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{full ? t("full") : t("pickerTitle")}</p>
      {full ? null : loading && !results ? (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <BrandLoader className="size-3.5" />
          {t("searching")}
        </p>
      ) : !results?.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("none")}</p>
      ) : (
        <ul id={id} role="listbox" aria-label={t("pickerTitle")} className="max-h-56 overflow-y-auto py-1">
          {results.map((f, i) => (
            <li
              key={f.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              // Picked on mouse down, so the box keeps its focus.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(f);
              }}
              onMouseEnter={() => onHover(i)}
              className={cn("grid cursor-pointer gap-0.5 px-3 py-1.5 text-sm", i === active && "bg-muted")}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate" dir="auto">
                  {f.title}
                </span>
              </span>
              {f.place || f.status !== "ok" ? (
                <span className="flex min-w-0 flex-wrap gap-x-2 ps-5 text-xs text-muted-foreground">
                  {f.place ? (
                    <span className="truncate" dir="auto">
                      {f.place}
                    </span>
                  ) : null}
                  {f.status !== "ok" ? <span className="text-warning">{t(`status.${f.status}`)}</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
