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
    parent?: {
        label: string;
        href: string;
    };
    ActionComponent?: ReactNode;
};

export const DashboardHeader = ({ title, parent, ActionComponent }: DashboardHeaderProps) => {
    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <Breadcrumb>
                <BreadcrumbList>
                    {parent && (
                        <>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href={parent.href}>{parent.label}</Link>
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
