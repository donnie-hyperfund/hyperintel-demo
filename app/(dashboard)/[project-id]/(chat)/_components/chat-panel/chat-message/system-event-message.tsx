'use client';

import type { LucideIcon } from 'lucide-react';
import { Check, Info, X } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { Message } from '@/modules/chat/types';

// ---------------------------------------------------------------------------
// Event display config — add new cases here when new system events are added
// ---------------------------------------------------------------------------

type EventDisplay = {
    icon: LucideIcon;
    iconClassName: string;
    label: ReactNode;
};

function resolveEvent(event: NonNullable<Message['systemEvent']>): EventDisplay {
    const name = <span className="font-medium text-foreground/70">{event.artifactKey ?? 'document'}</span>;
    const version = event.versionNumber != null ? <> v{event.versionNumber}</> : null;

    switch (event.type) {
        case 'artifact_approved':
            return {
                icon: Check,
                iconClassName: 'text-emerald-400/70',
                label: (
                    <>
                        {name} {version} approved
                    </>
                ),
            };
        case 'artifact_rejected':
            return {
                icon: X,
                iconClassName: 'text-red-400/70',
                label: (
                    <>
                        {name} {version} rejected
                    </>
                ),
            };
        default:
            return {
                icon: Info,
                iconClassName: 'text-muted-foreground',
                label: event.type.replaceAll('_', ' '),
            };
    }
}

// ---------------------------------------------------------------------------
// Component — generic layout shell, does not know about specific event types
// ---------------------------------------------------------------------------

export const SystemEventMessage = memo(({ message }: { message: Message }) => {
    if (!message.systemEvent) return null;

    const { icon: Icon, iconClassName, label } = resolveEvent(message.systemEvent);

    return (
        <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border/40" />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Icon className={`size-3.5 ${iconClassName}`} />
                <span>{label}</span>
            </div>
            <div className="h-px flex-1 bg-border/40" />
        </div>
    );
});

SystemEventMessage.displayName = 'SystemEventMessage';
