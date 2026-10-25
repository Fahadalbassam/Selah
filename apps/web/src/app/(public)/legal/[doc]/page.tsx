import type { Metadata } from "next";
import { ReadingProgress } from "@/components/reading-progress";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ToneBadge } from "@/components/tone-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/env";
import { edgeMode, LEGAL_DOCS, LEGAL_SLUGS, LEGAL_VERSIONS, legalDocFromSlug, type LegalDoc } from "@/lib/legal";

type Props = { params: Promise<{ doc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = legalDocFromSlug((await params).doc);
  const t = await getTranslations("legal");
  return { title: doc ? t(`${doc}.title`) : t("metaTitle") };
}

const ROWS = ["edge", "mail", "llm"] as const;

// The documents people accept at their first sign-in (terms, privacy notice,
// AI-use notice), and the ones a client's legal and IT teams read before
// signing (the data agreement template, the sub-processor list and the
// security overview, R5). Public, so they can be read before an account
// exists (R1).
export default async function LegalPage({ params }: Props) {
  const doc = legalDocFromSlug((await params).doc);
  if (!doc) notFound();
  const t = await getTranslations("legal");
  const sections = doc === "subprocessors" ? [] : (t.raw(`${doc}.sections`) as { title: string; body: string }[]);
  const version = doc in LEGAL_VERSIONS ? LEGAL_VERSIONS[doc as keyof typeof LEGAL_VERSIONS] : null;
  // What this server knows about itself: how traffic comes in and where the model runs.
  const e = env();
  const edge = edgeMode(e.SELAH_EDGE);
  const hosted = e.LLM_PROVIDER !== "ollama";
  const inUse = (row: (typeof ROWS)[number]) => (row === "llm" ? hosted : row === "edge" ? edge === "tunnel" : true);
  const facts =
    doc === "security"
      ? ([
          ["edge", edge ?? "none"],
          ["ai", !hosted ? "local" : e.AI_MASKING === "off" ? "unmasked" : "masked"],
          ["scan", e.SCAN_REQUIRED === "true" ? "on" : "off"],
          ["twoFactor", e.TWO_FACTOR_REQUIRED === "true" ? "on" : "off"],
          ["audit", "value"],
        ] as const)
      : null;

  return (
    <article className="mx-auto max-w-3xl animate-page-in space-y-8 px-6 py-12">
      <ReadingProgress />
      <header className="space-y-2">
        {version ? <p className="text-sm text-muted-foreground">{t("version", { version: `\u2066${version}\u2069` })}</p> : null}
        <h1 className="text-2xl font-semibold text-balance">{t(`${doc}.title`)}</h1>
        <p className="leading-relaxed text-muted-foreground">{t(`${doc}.intro`)}</p>
        {doc === "data_agreement" ? <p className="text-sm font-medium">{t("template")}</p> : null}
      </header>

      {facts ? (
        <section className="rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="mb-3 font-medium">{t("security.now")}</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{t(`security.facts.${k}.label`)}</dt>
                <dd>{t(`security.facts.${k}.${v}` as "security.facts.audit.value")}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {doc === "subprocessors" ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                {(["who", "what", "data", "where", "when"] as const).map((c) => (
                  <TableHead key={c}>{t(`columns.${c}`)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => (
                <TableRow key={r} className="align-top">
                  <TableCell className="min-w-36 whitespace-normal">
                    <p className="font-medium">{t(`subprocessors.rows.${r}.who`)}</p>
                    <ToneBadge tone={inUse(r) ? "open" : "neutral"} className="mt-1">
                      {inUse(r) ? t("inUse") : t("notInUse")}
                    </ToneBadge>
                  </TableCell>
                  {(["what", "data", "where", "when"] as const).map((c) => (
                    <TableCell key={c} className="min-w-32 text-sm whitespace-normal text-muted-foreground">
                      {t(`subprocessors.rows.${r}.${c}`)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="stagger space-y-6">
          {sections.map((s) => (
            <section key={s.title} className="space-y-1.5">
              <h2 className="font-medium">{s.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </section>
          ))}
        </div>
      )}

      <nav className="space-y-2 border-t pt-6">
        <p className="text-sm font-medium">{t("others")}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGAL_DOCS.filter((d: LegalDoc) => d !== doc).map((d) => (
            <li key={d}>
              <Link href={`/legal/${LEGAL_SLUGS[d]}`} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                {t(`${d}.title`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}
