'use client';

import type { ReactNode } from 'react';
import { type ErrorReferenceItem, ErrorReferenceList } from '@/components/ui/error-reference-list';

type AppErrorScreenProps = {
    title: string;
    description: string;
    referenceItems: ErrorReferenceItem[];
    primaryAction: ReactNode;
    secondaryAction?: ReactNode;
    eyebrow?: string;
};

export function AppErrorScreen({
    title,
    description,
    referenceItems,
    primaryAction,
    secondaryAction,
    eyebrow,
}: AppErrorScreenProps) {
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f1011] px-4 py-10 text-left">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.03),_transparent_34%)]" />

            <div className="relative w-full max-w-xl rounded-[28px] border border-white/10 bg-[#151617]/94 p-6 shadow-[0_24px_72px_rgba(0,0,0,0.42)] sm:p-8">
                <div className="space-y-5">
                    {eyebrow ? (
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
                            <span className="size-1.5 rounded-full bg-amber-300/80" />
                            {eyebrow}
                        </div>
                    ) : null}

                    <div className="min-w-0 space-y-2">
                        <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white">{title}</h1>
                        <p className="max-w-lg text-sm leading-7 text-white/62 sm:text-[15px]">{description}</p>
                    </div>

                    <ErrorReferenceList items={referenceItems} />

                    <div className="flex flex-col-reverse items-stretch gap-3 pt-1 sm:flex-row sm:items-center sm:justify-end">
                        {secondaryAction}
                        {primaryAction}
                    </div>
                </div>
            </div>
        </div>
    );
}
