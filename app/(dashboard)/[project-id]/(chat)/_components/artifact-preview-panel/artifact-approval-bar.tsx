'use client';

import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useApproveArtifactVersion, useRejectArtifactVersion } from '@/lib/api/client/hooks/use-artifacts';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

type ArtifactApprovalBarProps = {
    artifactKey: string;
};

export function ArtifactApprovalBar({ artifactKey }: ArtifactApprovalBarProps) {
    const { updateArtifact } = useArtifactContext();

    const params = useParams();
    const projectId = params?.['project-id'] as string;

    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    const { trigger: approve, isMutating: isApproving } = useApproveArtifactVersion(projectId, artifactKey);
    const { trigger: reject, isMutating: isRejecting } = useRejectArtifactVersion(projectId, artifactKey);

    const handleApprove = async () => {
        try {
            const updated = await approve();
            if (updated) {
                updateArtifact(artifactKey, updated, { merge: false });
            }
        } catch (err) {
            console.error('Failed to approve:', err);
        }
    };

    const handleReject = async () => {
        if (!rejectReason.trim()) return;
        try {
            const updated = await reject(rejectReason.trim());
            if (updated) {
                updateArtifact(artifactKey, updated, { merge: false });
            }

            setShowRejectInput(false);
            setRejectReason('');
        } catch (err) {
            console.error('Failed to reject:', err);
        }
    };

    return (
        <div className="border-t border-border px-4 py-3 space-y-2">
            <p className="text-xs text-muted-foreground text-center">This document is awaiting your approval</p>
            {showRejectInput ? (
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleReject()}
                        placeholder="Reason for rejection..."
                        className="flex-1 rounded-md border border-border bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-primary"
                        autoFocus
                    />
                    <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleReject}
                        disabled={isRejecting || !rejectReason.trim()}
                    >
                        {isRejecting ? <Loader2 className="size-3 animate-spin" /> : 'Reject'}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setShowRejectInput(false);
                            setRejectReason('');
                        }}
                    >
                        Cancel
                    </Button>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowRejectInput(true)}>
                        <XIcon className="size-3 mr-1" />
                        Reject
                    </Button>
                    <Button size="sm" onClick={handleApprove} disabled={isApproving}>
                        {isApproving ? (
                            <Loader2 className="size-3 animate-spin mr-1" />
                        ) : (
                            <Check className="size-3 mr-1" />
                        )}
                        Approve
                    </Button>
                </div>
            )}
        </div>
    );
}
