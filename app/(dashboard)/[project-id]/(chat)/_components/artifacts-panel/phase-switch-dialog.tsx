'use client';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type PhaseSwitchDialogProps = {
    open: boolean;
    phaseName: string;
    onConfirm: () => void;
    onClose: () => void;
};

export function PhaseSwitchDialog({ open, phaseName, onConfirm, onClose }: PhaseSwitchDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Switch phase</AlertDialogTitle>
                    <AlertDialogDescription>
                        This artifact was created in <strong>{phaseName}</strong>. We&apos;ll switch there and scroll to
                        the artifact in the conversation.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>Switch phase</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
