import { Mail } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MarkAllRead, NotificationList } from "@/components/notifications";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { withPrincipal } from "@/server/page";
import { listNotifications } from "@/services/notifications";

// The notification list alone (page audit row 34). Mail options and muted
// actions have their own view (/notifications/mail), opened from the user
// menu; the firm admin's messages from clients are on the admin's home (4.2).
export default async function NotificationsPage() {
  const { items, unread } = await withPrincipal(async (tx, principal) => listNotifications(tx, principal, 100));
  const [t, tNav] = await Promise.all([getTranslations("notifications"), getTranslations("nav")]);
  return (
    <>
      <PageHeader title={t("title")} description={t("unread", { n: unread })}>
        <Link href="/notifications/mail" data-slot="button" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <Mail />
          {tNav("mailOptions")}
        </Link>
        {unread > 0 ? <MarkAllRead /> : null}
      </PageHeader>
      <div className="overflow-hidden rounded-xl border bg-card">
        <NotificationList items={items} />
      </div>
    </>
  );
}
