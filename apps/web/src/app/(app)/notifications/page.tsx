import { Mail } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ApiButton } from "@/components/form-dialog";
import { MarkAllRead, NotificationList } from "@/components/notifications";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { ToneBadge } from "@/components/tone-badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { withPrincipal } from "@/server/page";
import { listSupportRequests } from "@/services/help";
import { listNotifications } from "@/services/notifications";

// The notification list (page audit row 34). Mail options and muted actions
// have their own view (/notifications/mail), opened from the user menu.
export default async function NotificationsPage() {
  const { items, unread, support } = await withPrincipal(async (tx, principal) => ({
    ...(await listNotifications(tx, principal, 100)),
    // The firm admin reads what clients reported from the help page (F13).
    // It stays here until the admin's home holds it (batch 2, homes).
    support: await listSupportRequests(tx, principal),
  }));
  const [t, tNav, tHelp, format, ar] = await Promise.all([
    getTranslations("notifications"),
    getTranslations("nav"),
    getTranslations("help.support"),
    getFormatter(),
    getLocale().then((l) => l === "ar"),
  ]);
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
      {support ? (
        <section id="support" className="scroll-mt-16 space-y-4">
          <SectionHeader title={tHelp("title")} description={tHelp("description")} />
          <div className="overflow-hidden rounded-xl border bg-card">
            {support.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{tHelp("none")}</p> : null}
            <ul className="divide-y">
              {support.map((r) => (
                <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground"> · {(ar ? r.orgNameAr : null) ?? r.orgName} · </span>
                      <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                        <bdi dir="ltr">{r.email}</bdi>
                      </a>
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                      <ToneBadge tone={r.handledAt ? "neutral" : "waiting"}>{r.handledAt ? tHelp("handled") : tHelp("open")}</ToneBadge>
                      {r.can.handle ? <ApiButton endpoint={`/api/support-requests/${r.id}/handle`} label={tHelp("handle")} variant="outline" size="sm" /> : null}
                    </div>
                  </div>
                  <p className="max-w-3xl whitespace-pre-wrap" dir="auto">
                    {r.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}
