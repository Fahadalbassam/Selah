import { FileText } from "@/components/animate-ui/icons/file-text";
import type { ReactNode } from "react";
import { ToneBadge, type Tone } from "@/components/tone-badge";

// One row for "the firm asked you for a file" (page audit 4.5, last
// paragraph; batch 4): an evidence item under its action and a document
// request on the project's Requests and files tab look and read the same.
// The title, its state word, its due date, what it is about, any note on the
// last decision, its files, then one outline main button (Send a file for
// the side asked, Accept for the firm) and the rest in the row's ⋯ menu.
// docs/placement.md says which state shows which word and button.

export interface RequestRowProps {
  title: string;
  description?: string | null;
  /** The state word and its tone (docs/placement.md). */
  state: { label: string; tone: Tone };
  /** Other quiet badges before the state (confidential, late). */
  badges?: ReactNode;
  /** One line of facts under the title: who it is asked of, the due date. */
  facts?: ReactNode[];
  /** The last decision's reason (not accepted, returned, not needed). */
  note?: ReactNode;
  /** The files sent for it. */
  files?: { key: string; node: ReactNode }[];
  /** Under the files: a no-login link, how the client sent it. */
  extra?: ReactNode;
  /** The row's one button, always outline: the page's solid button is its next step. */
  main?: ReactNode;
  /** The row's ⋯ menu (RowMenu). */
  menu?: ReactNode;
  as?: "li" | "div";
}

export function RequestRow(p: RequestRowProps) {
  const Tag = p.as ?? "li";
  const facts = (p.facts ?? []).filter(Boolean);
  return (
    <Tag className="space-y-2 px-4 py-3 text-sm" data-slot="request-row">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {/* Text in either language keeps the page's alignment. */}
          <p className="font-medium">
            <bdi>{p.title}</bdi>
          </p>
          {p.description ? (
            <p className="max-w-3xl whitespace-pre-line text-muted-foreground">
              <bdi>{p.description}</bdi>
            </p>
          ) : null}
          {facts.length ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{facts.map((f, i) => <span key={i}>{f}</span>)}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.badges}
          <ToneBadge tone={p.state.tone}>{p.state.label}</ToneBadge>
          {p.menu}
        </div>
      </div>
      {p.note ? <p className="max-w-3xl rounded-md bg-muted px-3 py-2 text-xs">{p.note}</p> : null}
      {p.files?.length ? (
        <ul className="flex flex-wrap gap-2">
          {p.files.map((f) => (
            <li key={f.key} className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              {f.node}
            </li>
          ))}
        </ul>
      ) : null}
      {p.extra}
      {p.main ? <div>{p.main}</div> : null}
    </Tag>
  );
}
