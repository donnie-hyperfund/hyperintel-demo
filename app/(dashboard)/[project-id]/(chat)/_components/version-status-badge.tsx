import { cva } from 'class-variance-authority';
import type { DisplayVersionStatus, VersionStatus } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

const badgeVariants = cva('px-1.5 py-0.25 text-[10px] font-medium rounded border', {
    variants: {
        status: {
            proposed: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            approved: 'bg-green-500/20 text-green-400 border-green-500/30',
            rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
            superseded: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
            deleted: 'bg-neutral-500/20 text-neutral-500 border-neutral-500/30 line-through',
        },
    },
});

const STATUS_LABELS: Record<DisplayVersionStatus, string> = {
    proposed: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    deleted: 'Deleted',
};

type VersionStatusBadgeProps = {
    status?: VersionStatus;
    className?: string;
};

export function VersionStatusBadge({ status, className }: VersionStatusBadgeProps) {
    if (!status || status === 'uploaded') return null;

    return <span className={cn(badgeVariants({ status }), className)}>{STATUS_LABELS[status]}</span>;
}
