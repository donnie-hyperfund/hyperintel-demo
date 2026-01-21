import { Skeleton } from '@/components/ui/skeleton';

export function ArtifactViewerSkeleton() {
    return (
        <div className="flex flex-col h-full bg-neutral-975">
            {/* Header skeleton */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <Skeleton className="size-4" />
                    <Skeleton className="h-5 w-48" />
                </div>
                <div className="flex items-center gap-1">
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                </div>
            </div>

            {/* Content skeleton */}
            <div className="flex-1 p-6">
                <div className="space-y-4">
                    <Skeleton className="h-8 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            </div>
        </div>
    );
}
