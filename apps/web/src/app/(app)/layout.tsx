import { Archive } from "lucide-react";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { PageTransition } from "@/components/animate-ui/components/page-transition";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantHost } from "@/components/assistant/assistant-card";
import { LocaleToggle } from "@/components/locale-toggle";
import { MorphCapture } from "@/components/morph";
import { NotificationBell } from "@/components/notifications";
import { ThemeSwitch } from "@/components/theme-switch";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { clientAssistant, hasHelp, sidebarFor, userMenuFor, type MenuKey } from "@/lib/nav";
import { withPrincipal } from "@/server/page";
import { myGroups } from "@/services/client-groups";
import { myClientAi } from "@/services/client-ai";
import { consultantNavFacts } from "@/services/nav";
import { unreadCount } from "@/services/notifications";
import { myOffboarding } from "@/services/offboarding";
import { getViewer } from "@/services/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { viewer, unread, leaving, groups, clientAi, firmFacts } = await withPrincipal(async (tx, principal) => ({
    viewer: await getViewer(tx, principal),
    unread: await unreadCount(tx, principal),
    // The people of an archived client read until their grace period ends (F27).
    leaving: await myOffboarding(tx, principal),
    groups: await myGroups(tx, principal),
    clientAi: await myClientAi(tx, principal),
    // A consultant's rows that show only when they apply (page audit 4.1).
    firmFacts: await consultantNavFacts(tx, principal),
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
  const firmStaff = viewer.role === "firm_admin" || viewer.role === "consultant";
  // The client assistant (F39, page audit row 15): the card once it is on, or the client admin's consent view.
  const assistant = clientAssistant(clientAi);
  const orgName = (rtl ? viewer.orgNameAr : null) ?? viewer.orgName;
  const navLabel = (k: string) => tNav(k as Parameters<typeof tNav>[0]);
  const groupsShown = sidebarFor(viewer.role, { ...firmFacts, inGroup: groups.length > 0, assistant: assistant.row }).map((section) => ({
    label: navLabel(section.label),
    items: section.rows.map((row) => ({ ...row, title: navLabel(row.key) })),
  }));
  const menu = userMenuFor(viewer.role, { assistantConsent: assistant.consentView }).map((i) => ({ ...i, label: navLabel(i.key as MenuKey) }));

  return (
    <NextIntlClientProvider>
      <SidebarProvider style={{ "--sidebar-width": "16rem", "--header-height": "3rem" } as CSSProperties}>
        <AppSidebar
          side={rtl ? "right" : "left"}
          appName={tApp("name")}
          orgName={orgName}
          roleLabel={tRole(viewer.role)}
          groups={groupsShown}
          orgKind={viewer.orgKind}
          railLabel={tHeader("toggleSidebar")}
          // Help for the client's people (F13), always at the foot above Files; firm staff have no help page.
          help={hasHelp(viewer.role) ? { title: tNav("help"), href: "/help" } : undefined}
          // Language and theme are in the top bar only (October review item 6).
          user={{ name: viewer.name, email: viewer.email, items: menu, signOut: tHeader("signOut") }}
        />
        {/* The assistant's floating card: stays open while the person moves between pages. */}
        {firmStaff || assistant.row === "card" ? <AssistantHost side={rtl ? "right" : "left"} client={!firmStaff} /> : null}
        {/* min-w-0: a wide table scrolls inside its card instead of pushing the page sideways. */}
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ms-1" aria-label={tHeader("toggleSidebar")} title={tHeader("toggleSidebar")} />
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            <span className="text-sm text-muted-foreground">{tApp("tagline")}</span>
            <div className="ms-auto flex items-center gap-1">
              <LocaleToggle label={tHeader("languageShort")} title={tHeader("switchLanguage")} />
              <ThemeSwitch label={tHeader("theme")} dir={rtl ? "rtl" : "ltr"} />
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
            {/* Pages cross-fade through a light blur, and titles shared by a list and the
                page it opens morph between them (components/morph.tsx). The shell
                around stays still. Reduced motion keeps only the cross-fade. */}
            <MorphCapture />
            <PageTransition effect="fade" className="flex min-w-0 flex-col gap-6">
              {children}
            </PageTransition>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </NextIntlClientProvider>
  );
}
