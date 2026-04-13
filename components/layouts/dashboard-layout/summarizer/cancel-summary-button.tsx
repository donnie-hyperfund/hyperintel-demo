'use client';

import { X } from 'lucide-react';
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
import { IconButton } from '@/components/ui/icon-button';

type CancelSummaryButtonProps = {
    onConfirm: () => void;
};

export function CancelSummaryButton({ onConfirm }: CancelSummaryButtonProps) {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <IconButton className="absolute top-6 right-6">
                    <X />
                </IconButton>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Cancel summarization?</AlertDialogTitle>
                    <AlertDialogDescription>
                        All generated documents will be discarded. You can start again later.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Keep going</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={onConfirm}
                    >
                        Discard
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
