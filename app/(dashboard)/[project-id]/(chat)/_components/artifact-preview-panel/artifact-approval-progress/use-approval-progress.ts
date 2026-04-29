import { useMemo, useState } from 'react';
import type { DocumentType } from '@/lib/schema/artifact';
import type { ProcessingEntry } from '@/modules/artifacts/processing/types';
import { type ApprovalProgressState, getApprovalProgressState } from './approval-progress-estimate';
import { useTicker } from './use-ticker';

type UseApprovalProgressOptions = {
    entry?: ProcessingEntry;
    documentType?: DocumentType;
    isInternal?: boolean;
    contentLength: number;
};

export function useApprovalProgress({
    entry,
    documentType,
    isInternal,
    contentLength,
}: UseApprovalProgressOptions): ApprovalProgressState {
    const [fallbackStartedAt] = useState(() => Date.now());
    const now = useTicker();

    return useMemo(
        () =>
            getApprovalProgressState({
                entry,
                now,
                fallbackStartedAt,
                documentType,
                isInternal,
                contentLength,
            }),
        [entry, now, fallbackStartedAt, documentType, isInternal, contentLength],
    );
}
