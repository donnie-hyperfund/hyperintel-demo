import { ErrorReferenceList } from '@/components/ui/error-reference-list';
import { describeError, type RetryAffordance } from '@/lib/errors';
import type { MessageMetadata } from '@/modules/chat/types';

const RETRY_HINTS: Record<RetryAffordance, string> = {
    suggested: 'Try again — this is usually temporary.',
    available: 'You can try again, or contact support if this keeps happening.',
    unavailable: 'Contact support with the reference below if you need assistance.',
};

export function ErrorBanner({ metadata }: { metadata?: MessageMetadata | null }) {
    const error = metadata?.error;
    const descriptor = describeError(error?.code);

    const references = [
        { label: 'Request ID', value: error?.referenceId },
        { label: 'Code', value: error?.code },
    ];

    return (
        <div className="mt-3 rounded-2xl border border-red-500/22 bg-red-500/8 p-4">
            <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-red-200/72">Request Failed</p>
                <p className="text-sm font-medium text-red-100">{descriptor.title}</p>
                <p className="text-sm leading-6 text-red-100/68">{RETRY_HINTS[descriptor.retry]}</p>
                {error?.detail && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-red-500/20 bg-black/30 p-2 text-[11px] leading-5 text-red-100/72 whitespace-pre-wrap break-all">
                        {error.detail}
                    </pre>
                )}
            </div>
            <ErrorReferenceList className="mt-3" items={references} variant="compact" />
        </div>
    );
}
