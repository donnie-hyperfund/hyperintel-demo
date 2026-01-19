'use client';

import { Code, FileCode, Layers, MessageSquare, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
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
    SidebarTrigger,
    useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { DashboardSidebarFooter } from './dashboard-sidebar-footer';

const navItems = [
    { icon: MessageSquare, label: 'Chats', href: '/chats' },
    { icon: FileCode, label: 'Projects', href: '/projects' },
    { icon: Layers, label: 'Artifacts', href: '/artifacts' },
    { icon: Code, label: 'Code', href: '/code' },
];

const projectNames = ['Project Name Goes Here', 'Project Name Goes Here', 'Project Name Goes Here'];

export function DashboardSidebar() {
    const { state } = useSidebar();
    const isCollapsed = state === 'collapsed';
    const isExpanded = !isCollapsed;
    const params = useParams();
    const pathname = usePathname();
    const projectId = params?.['project-id'] as string | undefined;

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
                                    tooltip={isCollapsed ? 'New Chat' : undefined}
                                    className="px-4"
                                >
                                    <Link href={projectId ? `/${projectId}` : '#'}>
                                        <div className="w-4 h-4 flex items-center justify-center overflow-visible">
                                            <div className="flex items-center justify-center size-6 rounded-full bg-green-500 shrink-0">
                                                <Plus className="size-4 text-neutral-900" />
                                            </div>
                                        </div>
                                        <span>New Chat</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            {navItems.map((item) => {
                                const Icon = item.icon;
                                // Projects page is at dashboard root, not project-scoped
                                // TODO proper fix, this is moronic
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

                {isExpanded && (
                    <SidebarGroup className="p-0">
                        <SidebarGroupLabel className="px-6 mb-1 text-xs font-semibold text-neutral-600">
                            Recents
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu className="gap-0.5 px-2">
                                {projectNames.map((name, idx) => (
                                    <SidebarMenuItem key={idx}>
                                        <SidebarMenuButton className="px-4 text-sm h-9 text-neutral-400 hover:text-neutral-100">
                                            <span className="truncate">{name}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                )}
            </SidebarContent>

            <SidebarFooter>
                <DashboardSidebarFooter isExpanded={isExpanded} />
            </SidebarFooter>
        </Sidebar>
    );
}
