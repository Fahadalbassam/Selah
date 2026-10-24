import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link2Off } from "lucide-react";
import { Lock } from "@/components/animate-ui/icons/lock";
import { Topography } from "@/components/topography";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isUploadLinkToken } from "@/lib/upload-links";
import { withAnonymous } from "@/server/page";
import { openUploadLink } from "@/services/upload-links";
import { UploadForm } from "./upload-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("uploadLink"))("metaTitle"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Where a no-login upload link lands (F14, decision D6): the one requested
 * item and the firm's name, and a place to send the file. Nothing else of
 * the client or the project. Opening it is logged by the database.
 */
export default async function UploadLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, locale, format] = await Promise.all([getTranslations("uploadLink"), getLocale(), getFormatter()]);
  const item = isUploadLinkToken(token) ? await withAnonymous((tx) => openUploadLink(tx, token, locale === "ar")) : null;
  return (
    <div className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden">
      <Topography className="-z-10" />
      <div className="mx-auto max-w-xl px-6 py-10 lg:py-16">
        {item ? (
          <Card className="shadow-xs">
            <CardHeader className="gap-2">
              <p className="text-sm text-muted-foreground">{t("from", { firm: item.firmName })}</p>
              <CardTitle className="text-xl">
                <bdi>{item.title}</bdi>
              </CardTitle>
              {item.description ? (
                <CardDescription className="whitespace-pre-line">
                  <bdi>{item.description}</bdi>
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {item.confidential ? (
                <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  {t("confidential")}
                </p>
              ) : null}
              <UploadForm token={token} />
              <p className="text-xs text-muted-foreground">
                {t("until", { date: format.dateTime(item.expiresAt, { dateStyle: "long", timeStyle: "short" }) })}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-xs">
            <CardHeader className="items-center gap-2 text-center">
              <Link2Off className="mx-auto size-8 text-muted-foreground" />
              <CardTitle className="text-xl">{t("deadTitle")}</CardTitle>
              <CardDescription>{t("dead")}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
