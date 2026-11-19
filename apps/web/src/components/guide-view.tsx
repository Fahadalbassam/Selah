import Link from "next/link";
import type { ReactNode } from "react";
import type { Block, Inline } from "@/lib/handbook";

function inline(parts: Inline[]): ReactNode {
  return parts.map((p, i) =>
    p.kind === "strong" ? (
      <strong key={i} className="font-semibold">
        {p.text}
      </strong>
    ) : p.kind === "code" ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
        {p.text}
      </code>
    ) : p.kind === "link" ? (
      p.href.startsWith("#") ? (
        <a key={i} href={p.href} className="text-primary hover:underline">
          {p.text}
        </a>
      ) : (
        <Link key={i} href={p.href} className="text-primary hover:underline">
          {p.text}
        </Link>
      )
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

/**
 * A handbook guide, drawn from the blocks lib/handbook.ts read from its
 * Markdown: plain React elements, never HTML from the file. The page's
 * own title is the guide's; its first heading is not drawn twice.
 */
export function GuideView({ blocks, dir }: { blocks: Block[]; dir: "rtl" | "ltr" }) {
  return (
    <article dir={dir} className="max-w-3xl space-y-4 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "anchor":
            // A section's id, so a link to /help/guide#client-admin opens at the reader's own part.
            return <span key={i} id={b.id} className="block scroll-mt-20" />;
          case "heading": {
            const cls = b.level <= 2 ? "pt-4 text-lg font-semibold tracking-tight" : "pt-2 text-base font-semibold";
            return b.level <= 2 ? (
              <h2 key={i} id={b.id} className={cls}>
                {inline(b.text)}
              </h2>
            ) : (
              <h3 key={i} id={b.id} className={cls}>
                {inline(b.text)}
              </h3>
            );
          }
          case "paragraph":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return (
              <blockquote key={i} className="rounded-lg border-s-2 bg-muted/50 px-4 py-2 text-muted-foreground">
                {inline(b.text)}
              </blockquote>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={b.ordered ? "list-decimal space-y-1 ps-6" : "list-disc space-y-1 ps-6"}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-start text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="px-3 py-2 text-start font-medium">
                          {inline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="px-3 py-2 align-top">
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
}
