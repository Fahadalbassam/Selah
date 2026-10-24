import { Archive } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { AppSidebar, type NavGroup } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notifications";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { Role } from "@/authz";
import { withPrincipal } from "@/server/page";
import { unreadCount } from "@/services/notifications";
import { myOffboarding } from "@/services/offboarding";
import { getViewer } from "@/services/queries";

function navFor(role: Role, t: (key: string) => string): NavGroup[] {
  const overview = { title: t("overview"), href: "/", icon: "overview" as const };
  const team = { title: t("team"), href: "/team", icon: "team" as const };
  if (role === "firm_admin" || role === "consultant") {
    return [
      {
        label: t("workspace"),
        items: [
          overview,
          {
            title: t("projects"),
            href: "/projects",
            icon: "projects",
            items: [
              { title: t("allProjects"), href: "/projects" },
              { title: t("clientProjects"), href: "/projects?kind=client" },
              { title: t("internalProjects"), href: "/projects?kind=internal" },
            ],
          },
          { title: t("clients"), href: "/clients", icon: "clients" },
          { title: t("inquiries"), href: "/inquiries", icon: "inquiries" },
          { title: t("actions"), href: "/actions", icon: "actions" },
          { title: t("reviewQueue"), href: "/review", icon: "review" },
          { title: t("templates"), href: "/templates", icon: "templates" },
          { title: t("assistant"), href: "/assistant", icon: "assistant" },
        ],
      },
      {
        label: t("organization"),
        items: [
          {
            ...team,
            items: [
              { title: t("people"), href: "/team" },
              { title: t("expertise"), href: "/team/expertise" },
            ],
          },
          ...(role === "firm_admin"
            ? [
                { title: t("audit"), href: "/audit", icon: "audit" as const },
                { title: t("settings"), href: "/settings", icon: "settings" as const },
              ]
            : []),
        ],
      },
    ];
  }
  if (role === "action_owner") {
    return [
      {
        label: t("workspace"),
        items: [overview, { title: t("myActions"), href: "/actions", icon: "actions" }, { title: t("projects"), href: "/projects", icon: "projects" }],
      },
    ];
  }
  return [
    {
      label: t("workspace"),
      items: [overview, { title: t("projects"), href: "/projects", icon: "projects" }, { title: t("actions"), href: "/actions", icon: "actions" }],
    },
    {
      label: t("organization"),
      items: [
        team,
        { title: t("departments"), href: "/departments", icon: "departments" },
        ...(role === "client_admin" ? [{ title: t("audit"), href: "/audit", icon: "audit" as const }] : []),
      ],
    },
  ];
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { viewer, unread, leaving } = await withPrincipal(async (tx, principal) => ({
    viewer: await getViewer(tx, principal),
    unread: await unreadCount(tx, principal),
    // The people of an archived client read until their grace period ends (F27).
    leaving: await myOffboarding(tx, principal),
  }));
  const locale = await getLocale();
  const [tNav, tRole, tHeader, tApp, tOff, format] = await Promise.all([
    getTranslations("nav"),
    getTranslations("role"),
    getTranslations("header"),
    getTranslations("app"),
    getTranslations("offboarding"),
    getFormatter(),
  ]);
  const rtl = locale === "ar";
  const orgName = (rtl ? viewer.orgNameAr : null) ?? viewer.orgName;

  return (
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--header-height": "3rem" } as CSSProperties}>
      <AppSidebar
        side={rtl ? "right" : "left"}
        appName={tApp("name")}
        orgName={orgName}
        roleLabel={tRole(viewer.role)}
        groups={navFor(viewer.role, (k) => tNav(k))}
        orgKind={viewer.orgKind}
        railLabel={tHeader("toggleSidebar")}
        user={{
          name: viewer.name,
          email: viewer.email,
          otherLocale: rtl ? "en" : "ar",
          labels: { language: tHeader("language"), theme: tHeader("theme"), security: tHeader("security"), signOut: tHeader("signOut") },
        }}
      />
      {/* min-w-0: a wide table scrolls inside its card instead of pushing the page sideways. */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" aria-label={tHeader("toggleSidebar")} title={tHeader("toggleSidebar")} />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <span className="text-sm text-muted-foreground">{tApp("tagline")}</span>
          <div className="ms-auto">
            <NotificationBell unread={unread} />
          </div>
        </header>
        <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
          {leaving ? (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
              <Archive className="size-4 shrink-0" />
              {tOff("clientBanner", { date: format.dateTime(leaving.graceUntil, { dateStyle: "long" }) })}
              {leaving.admin ? (
                <Link href="/leaving" className="ms-auto shrink-0 font-medium text-foreground hover:underline">
                  {tOff("pack.open")}
                </Link>
              ) : null}
            </p>
          ) : null}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
