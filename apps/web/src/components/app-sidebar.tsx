"use client";

import {
  Bot,
  Building2,
  ClipboardList,
  FolderKanban,
  House,
  Inbox,
  LifeBuoy,
  ListChecks,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { AssistantSidebarItem } from "@/components/assistant/assistant-card";
import { SidebarBrand } from "@/components/brand";
import { FilesSidebarItem } from "@/components/file-explorer";
import { NavUser, type NavUserProps } from "@/components/nav-user";
import type { NavKey } from "@/lib/nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

// Icons are chosen here by the row's key: server components cannot pass functions.
const ICONS = {
  home: House,
  myActions: ListChecks,
  projects: FolderKanban,
  clients: Building2,
  inquiries: Inbox,
  actions: ListChecks,
  templates: ClipboardList,
  assistant: Bot,
  team: Users,
  people: Users,
  audit: ScrollText,
  group: Building2,
} satisfies Record<NavKey, LucideIcon>;

export interface NavItem {
  key: NavKey;
  title: string;
  href: string;
  /** The assistant: opens its floating card instead of a page. */
  card?: boolean;
  /** Other pages this row stands for (its tabs and filters), so it stays marked there. */
  match?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface AppSidebarProps extends ComponentProps<typeof Sidebar> {
  appName: string;
  orgName: string;
  roleLabel: string;
  groups: NavGroup[];
  user: NavUserProps;
  /** Which side of the workspace the person is on (the file explorer's wording). */
  orgKind: "firm" | "client";
  /** Accessible name of the thin rail that toggles the sidebar. */
  railLabel: string;
  /** Client side (F13): the help page, always in the same place at the foot of the menu. */
  help?: { title: string; href: string };
}

/**
 * Based on shadcn/ui block sidebar-07 (collapses to icons). One sidebar per
 * role, with no sub-entries (page audit 4.1): the rows come from sidebarFor()
 * in lib/nav.ts. The menu only reflects what the server decided this user may
 * open; it is not the access control.
 */
export function AppSidebar({ appName, orgName, roleLabel, groups, user, orgKind, railLabel, help, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <Link href="/" className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <SidebarBrand label={appName} />
        </Link>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={orgName} className="cursor-default hover:bg-transparent active:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-semibold">{orgName}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                if (item.card) return <AssistantSidebarItem key={item.href} title={item.title} />;
                const Icon = ICONS[item.key];
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.href) || Boolean(item.match?.some(isActive))}>
                      <Link href={item.href}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        <SidebarGroup className="mt-auto">
          {help ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={help.title} isActive={isActive(help.href)}>
                  <Link href={help.href}>
                    <LifeBuoy />
                    <span>{help.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
          <FilesSidebarItem orgKind={orgKind} side={props.side === "right" ? "right" : "left"} />
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser {...user} />
      </SidebarFooter>
      <SidebarRail aria-label={railLabel} title={railLabel} />
    </Sidebar>
  );
}
