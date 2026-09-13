'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { History, ListChecks, Plus, Workflow } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export function AppSidebar({ loops }: { loops: Array<{ id: string; name: string }> }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2.5 px-1.5 py-1">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            loop
          </span>
        </Link>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/new" />}
              tooltip="New loop"
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            >
              <Plus />
              <span>New loop</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/" />}
                  isActive={pathname === '/'}
                  tooltip="Loops"
                >
                  <ListChecks />
                  <span>Loops</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/runs" />}
                  isActive={pathname === '/runs'}
                  tooltip="Runs"
                >
                  <History />
                  <span>Runs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {loops.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {loops.slice(0, 8).map((loop) => (
                  <SidebarMenuItem key={loop.id}>
                    <SidebarMenuButton
                      render={<Link href={`/loops/${loop.id}`} />}
                      isActive={pathname === `/loops/${loop.id}`}
                      tooltip={loop.name}
                    >
                      <Workflow />
                      <span>{loop.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
          Show it once.
          <br />
          It does it forever.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
