import { getTranslations } from "next-intl/server";
import { MailChoicesForm, MutedActions } from "@/components/mail-choices";
import { MarkAllRead, NotificationList } from "@/components/notifications";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { withPrincipal } from "@/server/page";
import { getMailPreferences, listNotifications } from "@/services/notifications";

export default async function NotificationsPage() {
  const { items, unread, mail } = await withPrincipal(async (tx, principal) => ({
    ...(await listNotifications(tx, principal, 100)),
    mail: await getMailPreferences(tx, principal),
  }));
  const t = await getTranslations("notifications");
  const { muted, nextMailAt, ...choices } = mail;
  return (
    <>
      <PageHeader title={t("title")} description={t("unread", { n: unread })}>
        {unread > 0 ? <MarkAllRead /> : null}
      </PageHeader>
      <div className="overflow-hidden rounded-xl border bg-card">
        <NotificationList items={items} />
      </div>
      <SectionHeader title={t("mail.section")} description={t("mail.sectionHint")} />
      <MailChoicesForm initial={{ ...choices, nextMailAt: nextMailAt?.toISOString() ?? null }} />
      <MutedActions items={muted} />
    </>
  );
}
