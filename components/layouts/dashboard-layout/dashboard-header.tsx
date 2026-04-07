'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type DashboardHeaderProps = {
    title: string;
    parent?: {
        label: string;
        href: string;
    };
    ActionComponent?: ReactNode;
};

export const DashboardHeader = ({ title, parent, ActionComponent }: DashboardHeaderProps) => {
    return (
        <header className="h-14 border-b border-border flex items-center px-4 md:px-6 gap-3">
            <Tooltip>
                <TooltipTrigger asChild>
                    <SidebarTrigger className="md:hidden size-8 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>Toggle sidebar</TooltipContent>
            </Tooltip>
            <Breadcrumb className="min-w-0">
                <BreadcrumbList>
                    {parent && (
                        <>
                            <BreadcrumbItem className="min-w-0">
                                <BreadcrumbLink asChild>
                                    <Link href={parent.href} className="truncate">
                                        {parent.label}
                                    </Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator className="shrink-0" />
                        </>
                    )}
                    <BreadcrumbItem className="min-w-0">
                        <span className="text-sm font-medium text-muted-foreground/70 truncate">{title}</span>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>
            {ActionComponent && <div className="ml-auto shrink-0">{ActionComponent}</div>}
        </header>
    );
};
