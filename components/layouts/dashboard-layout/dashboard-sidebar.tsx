'use client';

import { useAuth } from '@clerk/nextjs';
import { ChevronRight, Code, FileCode, Layers, MessageSquare, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarTrigger,
    useSidebar,
} from '@/components/ui/sidebar';
import { createApiClient } from '@/lib/api/client';
import type { ChatDto } from '@/lib/schema/message';
import { cn } from '@/lib/utils';
import { DashboardSidebarFooter } from './dashboard-sidebar-footer';

const navItems = [
    { icon: FileCode, label: 'Projects', href: '/projects' },
    { icon: Layers, label: 'Artifacts', href: '/artifacts' },
    { icon: Code, label: 'Code', href: '/code' },
];

export function DashboardSidebar() {
    const { state } = useSidebar();
    const isCollapsed = state === 'collapsed';
    const isExpanded = !isCollapsed;
    const params = useParams();
    const pathname = usePathname();
    const projectId = params?.['project-id'] as string | undefined;
    const { getToken } = useAuth();

    const api = useMemo(() => createApiClient(getToken), [getToken]);
    const [chats, setChats] = useState<ChatDto[]>([]);

    useEffect(() => {
        if (!projectId) return;
        api.chats.list(projectId, { limit: 20 }).then((res) => {
            const sorted = [...(res.data ?? [])].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
            setChats(sorted);
        });
    }, [api, projectId, pathname]);

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
                        <SidebarMenu className="gap-1">
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    asChild
                                    tooltip={isCollapsed ? 'New Phase' : undefined}
                                    className="px-4"
                                >
                                    <Link href={projectId ? `/${projectId}` : '#'}>
                                        <div className="w-4 h-4 flex items-center justify-center overflow-visible">
                                            <div className="flex items-center justify-center size-6 rounded-full bg-green-500 shrink-0">
                                                <Plus className="size-4 text-neutral-900" />
                                            </div>
                                        </div>
                                        <span>New Phase</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>

                            {/* Phases with collapsible sub-items */}
                            <Collapsible asChild defaultOpen={isPhasesActive} className="group/collapsible">
                                <SidebarMenuItem>
                                    <div className="relative">
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isPhasesActive}
                                            tooltip={isCollapsed ? 'Phases' : undefined}
                                            className={cn('px-4', isPhasesActive && 'bg-neutral-850 text-neutral-100')}
                                        >
                                            <Link href={projectId ? `/${projectId}/chats` : '#'}>
                                                <MessageSquare />
                                                <span>Phases</span>
                                            </Link>
                                        </SidebarMenuButton>
                                        {chats.length > 0 && (
                                            <CollapsibleTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-5 rounded-md hover:bg-neutral-800 group-data-[collapsible=icon]:hidden"
                                                >
                                                    <ChevronRight className="size-3.5 text-neutral-500 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                                </button>
                                            </CollapsibleTrigger>
                                        )}
                                    </div>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {chats.map((chat, index) => {
                                                const chatHref = `/${projectId}/chats/${chat.id}`;
                                                const label = `Phase ${index + 1}`;
                                                return (
                                                    <SidebarMenuSubItem key={chat.id}>
                                                        <SidebarMenuSubButton
                                                            asChild
                                                            size="sm"
                                                            isActive={pathname === chatHref}
                                                        >
                                                            <Link href={chatHref}>
                                                                <span className="truncate">{label}</span>
                                                            </Link>
                                                        </SidebarMenuSubButton>
                                                    </SidebarMenuSubItem>
                                                );
                                            })}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </SidebarMenuItem>
                            </Collapsible>

                            {navItems.map((item) => {
                                const Icon = item.icon;
                                const isProjectsPage = item.href === '/projects';
                                const href = isProjectsPage
                                    ? '/projects'
                                    : projectId
                                      ? `/${projectId}${item.href}`
                                      : '#';
                                const isActive = isProjectsPage
                                    ? pathname === '/projects'
                                    : pathname?.startsWith(`/${projectId}${item.href}`);

                                return (
                                    <SidebarMenuItem key={item.label}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            tooltip={isCollapsed ? item.label : undefined}
                                            className={cn('px-4', isActive && 'bg-neutral-850 text-neutral-100')}
                                        >
                                            <Link href={href}>
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
