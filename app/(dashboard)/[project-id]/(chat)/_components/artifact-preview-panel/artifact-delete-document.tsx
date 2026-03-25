'use client';

import { Loader2, Trash2 } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { useDeleteProjectArtifact } from '@/lib/api/client/hooks/use-project-artifacts';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type ArtifactDeleteDocumentProps = {
    artifactKey: string;
    title: string;
    onProcessingChange?: (isProcessing: boolean) => void;
    onDeleted?: () => void;
};

export function ArtifactDeleteDocument({
    artifactKey,
    title,
    onProcessingChange,
    onDeleted,
}: ArtifactDeleteDocumentProps) {
    const { projectId } = useChatContext<'phase'>();
    // TODO: Use the unified artifact API when backend is updated
    const { trigger: deleteArtifact, isMutating } = useDeleteProjectArtifact(projectId, artifactKey);

    const handleDelete = async () => {
        try {
            onProcessingChange?.(true);
            await deleteArtifact();
            toast({ title: `"${title}" has been deleted` });
            onDeleted?.();
        } catch (err) {
            console.error('Failed to delete artifact:', err);
            toast({ title: 'Failed to delete artifact', variant: 'destructive' });
        } finally {
            onProcessingChange?.(false);
        }
    };

    return (
        <AlertDialog>
            <Tooltip>
                <TooltipTrigger asChild>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" disabled={isMutating}>
                            {isMutating ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        </Button>
                    </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>{isMutating ? 'Deleting...' : 'Delete artifact'}</TooltipContent>
            </Tooltip>
            <AlertDialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete artifact</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to permanently delete <strong>{title}</strong>? This action cannot be
                        undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={handleDelete}>
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
