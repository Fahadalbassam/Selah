"use client";

import {
  Bot,
  Building2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { SidebarBrand } from "@/components/brand";
import { NavUser, type NavUserProps } from "@/components/nav-user";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

// Icons are referenced by name: server components cannot pass functions.
const ICONS = {
  overview: LayoutDashboard,
  projects: FolderKanban,
  clients: Building2,
  inquiries: Inbox,
  actions: ListChecks,
  review: ClipboardCheck,
  templates: ClipboardList,
  assistant: Bot,
  team: Users,
} satisfies Record<string, LucideIcon>;

export interface NavItem {
  title: string;
  href: string;
  icon: keyof typeof ICONS;
  items?: { title: string; href: string }[];
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
}

/**
 * Based on shadcn/ui blocks sidebar-07 (collapses to icons) and sidebar-03
 * (sub-menus). The menu only reflects what the server decided this user may
 * open; it is not the access control.
 */
export function AppSidebar({ appName, orgName, roleLabel, groups, user, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = search ? `${pathname}?${search}` : pathname;
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
                const Icon = ICONS[item.icon];
                if (!item.items?.length) {
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive(item.href)}>
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }
                return (
                  <Collapsible key={item.href} asChild defaultOpen={isActive(item.href)} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={item.title} isActive={isActive(item.href)}>
                          <Icon />
                          <span>{item.title}</span>
                          <ChevronRight className="ms-auto transition-transform duration-(--duration-base) ease-(--ease-out-soft) group-data-[state=open]/collapsible:rotate-90 rtl:-scale-x-100 rtl:group-data-[state=open]/collapsible:-rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((sub) => (
                            <SidebarMenuSubItem key={sub.href}>
                              <SidebarMenuSubButton asChild isActive={current === sub.href}>
                                <Link href={sub.href}>
                                  <span>{sub.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser {...user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
