import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export const ArtifactItemSkeleton = () => {
    return (
        <Card className="py-4">
            <CardHeader className="mb-0 gap-1 py-0">
                <div className="flex items-center gap-2">
                    <Skeleton className="size-4 shrink-0" />
                    <Skeleton className="h-5 w-3/4" />
                </div>
            </CardHeader>
            <CardContent className="py-0 pt-1">
                <Skeleton className="h-3 w-32" />
            </CardContent>
        </Card>
    );
};
