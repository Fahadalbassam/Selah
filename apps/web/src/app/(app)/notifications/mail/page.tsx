import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailChoicesForm, MutedActions } from "@/components/mail-choices";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { getMailPreferences } from "@/services/notifications";

// The person's own mail options and the actions and indicators they muted
// (page audit row 34): their own view, opened from the user menu. It was the
// foot of the notification list. Everyone signed in has one.
export default async function MailOptionsPage() {
  const mail = await withPrincipal((tx, principal) => getMailPreferences(tx, principal));
  const [t, tNav] = await Promise.all([getTranslations("notifications"), getTranslations("nav")]);
  const { muted, mutedIndicators, nextMailAt, ...choices } = mail;
  return (
    <>
      <Link href="/notifications" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("title")}
      </Link>
      <PageHeader title={tNav("mailOptions")} description={t("mail.sectionHint")} />
      <MailChoicesForm initial={{ ...choices, nextMailAt: nextMailAt?.toISOString() ?? null }} />
      <MutedActions items={muted} indicators={mutedIndicators} />
    </>
  );
}
