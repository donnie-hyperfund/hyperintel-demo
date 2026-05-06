'use client';

import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useCallback, useState } from 'react';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { Pill } from './pill';

export type ContextWarningStage = 'caution' | 'warn';

const STAGE_CONFIG = {
    caution: {
        label: 'Approaching context limit — quality may degrade',
        icon: <TrendingUp className="size-4 shrink-0" />,
        baseColor: 'rgb(161,98,7)',
    },
    warn: {
        label: 'Context limit reached — Completion Brief required to continue',
        icon: <AlertTriangle className="size-4 shrink-0" />,
        baseColor: 'rgb(185,28,28)',
    },
} as const;

type ContextWarningPillProps = {
    stage: ContextWarningStage;
    className?: string;
};

export function ContextWarningPill({ stage, className }: ContextWarningPillProps) {
    const { requestCbGeneration } = usePhaseGate();
    const [cautionDismissed, setCautionDismissed] = useState(false);

    const handleDismissCaution = useCallback(() => {
        setCautionDismissed(true);
    }, []);

    if (stage === 'caution' && cautionDismissed) return null;

    const config = STAGE_CONFIG[stage];

    return (
        <Pill
            label={config.label}
            icon={config.icon}
            baseColor={config.baseColor}
            contentKey={stage}
            onClick={requestCbGeneration}
            onDismiss={stage === 'caution' ? handleDismissCaution : undefined}
            className={className}
        />
    );
}
