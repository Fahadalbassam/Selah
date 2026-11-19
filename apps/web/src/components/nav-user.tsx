"use client";

import { Bot, ChevronsUpDown, Database, GraduationCap, LifeBuoy, Mail, Settings, type LucideIcon } from "lucide-react";
import { LogOut } from "@/components/animate-ui/icons/log-out";
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import type { MenuKey } from "@/lib/nav";
import { initials } from "@/lib/utils";

const ICONS: Record<MenuKey, LucideIcon | ComponentType<{ className?: string }>> = {
  settings: Settings,
  myExpertise: GraduationCap,
  dataSharing: Database,
  assistantConsent: Bot,
  mailOptions: Mail,
  security: ShieldCheck,
  help: LifeBuoy,
};

export interface NavUserProps {
  name: string;
  email: string;
  /** The person's own pages, from userMenuFor() in lib/nav.ts. Language and theme stay in the top bar. */
  items: { key: MenuKey; label: string; href: string }[];
  signOut: string;
  /**
   * "Your manager: …" for someone whose position is on the company's structure (org chart, part 5),
   * as the server worded it: the name only where the database gave one.
   */
  manager?: string[];
}

/** The menu under the person's name at the foot of the sidebar (page audit 4.1). */
export function NavUser({ name, email, items, signOut, manager = [] }: NavUserProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground" dir="ltr">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ms-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "top"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="font-normal">
              <div className="grid text-start text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground" dir="ltr">
                  {email}
                </span>
                {manager.map((line) => (
                  <span key={line} className="mt-1 text-xs text-muted-foreground" dir="auto">
                    {line}
                  </span>
                ))}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {items.map((item) => {
                const Icon = ICONS[item.key];
                return (
                  <DropdownMenuItem key={item.key} asChild>
                    <Link href={item.href}>
                      <Icon />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut();
                router.replace("/sign-in");
                router.refresh();
              }}
            >
              <LogOut />
              {signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
