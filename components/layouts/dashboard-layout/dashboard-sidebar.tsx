'use client';

import { Building, FileCode, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarTrigger,
    useSidebar,
} from '@/components/ui/sidebar';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { sortChatsByCreatedAt } from '@/lib/phases';
import { cn } from '@/lib/utils';
import { DashboardSidebarFooter } from './dashboard-sidebar-footer';

const navItems = [
    { icon: FileCode, label: 'Projects', href: '/projects' },
    { icon: User, label: 'Stakeholders', href: '/stakeholders' },
    { icon: Building, label: 'Companies', href: '/companies' },
];

export function DashboardSidebar() {
    const { state } = useSidebar();
    const isCollapsed = state === 'collapsed';
    const isExpanded = !isCollapsed;
    const params = useParams();
    const pathname = usePathname();
    const projectId = params?.['project-id'] as string | undefined;

    const { data: chatsData } = useFetchChats(projectId, { limit: 20 });
    const chats = sortChatsByCreatedAt(chatsData?.data ?? []);

    const isPhasesActive = pathname?.startsWith(`/${projectId}/chats`) || pathname === `/${projectId}`;

    return (
        <Sidebar collapsible="icon" className="border-r border-neutral-800">
            <SidebarHeader
                className={cn(
                    'px-4 h-16 flex flex-row items-center mb-3',
                    isExpanded ? 'justify-between' : 'justify-center',
                )}
            >
                {isExpanded ? (
                    <>
                        <div className="overflow-visible w-full">
                            <div className="w-[143px] h-[28px] flex items-center justify-center overflow-visible">
                                <Image src="/logo.svg" alt="HYPERINTEL" width={143} height={28} className="shrink-0" />
                            </div>
                        </div>
                        <SidebarTrigger />
                    </>
                ) : (
                    <SidebarTrigger />
                )}
            </SidebarHeader>

            <SidebarContent className="gap-5">
                <SidebarGroup className="px-2">
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-1.5">
                            {navItems.map((item) => {
                                const Icon = item.icon;
                                const isActive = pathname?.startsWith(item.href);

                                return (
                                    <SidebarMenuItem key={item.label}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            tooltip={isCollapsed ? item.label : undefined}
                                            className={cn('px-4', isActive && 'bg-neutral-850 text-neutral-100')}
                                        >
                                            <Link href={item.href}>
                                                <Icon />
                                                <span>{item.label}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <DashboardSidebarFooter isExpanded={isExpanded} />
            </SidebarFooter>
        </Sidebar>
    );
}
