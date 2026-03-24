'use client';

import { EyeOff, SparklesIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Progress } from '@/components/ui/progress';

type InternalDocumentContentProps = {
    title: string;
    progress?: number;
    isStreaming: boolean;
};

type Phase = 'idle' | 'generating' | 'completing';

const COMPLETION_HOLD_MS = 1200;

export function InternalDocumentContent({ title, progress, isStreaming }: InternalDocumentContentProps) {
    const [phase, setPhase] = useState<Phase>(isStreaming ? 'generating' : 'idle');
    const phaseRef = useRef(phase);
    phaseRef.current = phase;

    useEffect(() => {
        if (isStreaming) {
            setPhase('generating');
            return;
        }

        // Streaming just ended — hold at 100% before transitioning
        if (phaseRef.current === 'generating') {
            setPhase('completing');
            const timer = setTimeout(() => setPhase('idle'), COMPLETION_HOLD_MS);
            return () => clearTimeout(timer);
        }
    }, [isStreaming]);

    const displayProgress = phase === 'completing' ? 100 : (progress ?? 0);

    if (phase === 'generating' || phase === 'completing') {
        return (
            <div className="flex items-center justify-center h-full px-6">
                <div className="w-full max-w-xs space-y-4 text-center">
                    <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                        <SparklesIcon className="size-5 text-primary animate-pulse" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Generating document</p>
                        <p className="text-xs text-muted-foreground">{title}</p>
                    </div>
                    <div className="space-y-2">
                        <Progress value={displayProgress} className="h-1.5" />
                        <p className="text-xs tabular-nums text-muted-foreground">{displayProgress}%</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center h-full px-6">
            <div className="max-w-md rounded-2xl border border-border bg-background/30 p-6 text-center text-muted-foreground">
                <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                    <EyeOff className="size-5" />
                </div>
                <p className="font-medium text-foreground">Preview unavailable</p>
                <p className="mt-2 text-sm leading-6">
                    This document type is tracked in the workflow and version history, but it is not presented as a
                    reviewable preview. Use the visible outputs and status indicators to track progress.
                </p>
            </div>
        </div>
    );
}
