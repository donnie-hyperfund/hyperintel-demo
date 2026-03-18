'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { Button } from '@/components/ui/button';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';

type IntakeHeaderProps = {
    title: string;
    defaultParent: {
        label: string;
        href: string;
    };
};

export function IntakeHeader({ title, defaultParent }: IntakeHeaderProps) {
    const { parent: originParent, backHref, infoText } = useOptionalProjectOrigin();

    const parent = originParent ?? defaultParent;
    const actionComponent = backHref ? (
        <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>
                <ArrowLeft className="size-4" />
                Back to project
            </Link>
        </Button>
    ) : undefined;

    return (
        <>
            <DashboardHeader title={title} parent={parent} ActionComponent={actionComponent} />
            {infoText && <ProjectOriginNotice>{infoText}</ProjectOriginNotice>}
        </>
    );
}

function ProjectOriginNotice({ children }: { children: ReactNode }) {
    return (
        <div className="border-b border-border bg-neutral-950/60 px-6 py-2.5 text-xs text-muted-foreground">
            {children}
        </div>
    );
}
