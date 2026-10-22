import { getTranslations } from "next-intl/server";
import { MarkAllRead, NotificationList } from "@/components/notifications";
import { PageHeader } from "@/components/page-header";
import { withPrincipal } from "@/server/page";
import { listNotifications } from "@/services/notifications";

export default async function NotificationsPage() {
  const { items, unread } = await withPrincipal((tx, principal) => listNotifications(tx, principal, 100));
  const t = await getTranslations("notifications");
  return (
    <>
      <PageHeader title={t("title")} description={t("unread", { n: unread })}>
        {unread > 0 ? <MarkAllRead /> : null}
      </PageHeader>
      <div className="overflow-hidden rounded-xl border bg-card">
        <NotificationList items={items} />
      </div>
    </>
  );
}
