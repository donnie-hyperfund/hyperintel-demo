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

type DashboardHeaderProps = {
    title: string;
    parentLabel?: string;
    parentHref?: string;
    ActionComponent?: ReactNode;
};

export const DashboardHeader = ({ title, parentLabel, parentHref, ActionComponent }: DashboardHeaderProps) => {
    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <Breadcrumb>
                <BreadcrumbList>
                    {parentLabel && parentHref && (
                        <>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href={parentHref}>{parentLabel}</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                        </>
                    )}
                    <BreadcrumbItem>
                        <span className="text-sm font-medium text-muted-foreground/70">{title}</span>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>
            {ActionComponent && <div className="ml-auto">{ActionComponent}</div>}
        </header>
    );
};
