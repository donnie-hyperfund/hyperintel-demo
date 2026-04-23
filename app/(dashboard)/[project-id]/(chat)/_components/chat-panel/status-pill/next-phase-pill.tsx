'use client';

import { ArrowRight } from 'lucide-react';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { Pill } from './pill';

type NextPhasePillProps = {
    className?: string;
};

export function NextPhasePill({ className }: NextPhasePillProps) {
    const { summarizeChat } = useChatContext();

    return (
        <Pill
            label="Switch to next phase"
            icon={<ArrowRight className="size-4 shrink-0" />}
            baseColor="rgb(21,128,61)"
            onClick={summarizeChat}
            className={className}
        />
    );
}
