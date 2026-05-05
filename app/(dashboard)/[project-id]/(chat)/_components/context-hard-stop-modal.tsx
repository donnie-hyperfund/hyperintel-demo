'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

type ContextHardStopModalProps = {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    onNavigate?: () => void;
    state: 'idle' | 'forcing' | 'already-transitioned';
    existingNextChatId?: string;
    error?: string | null;
};

export function ContextHardStopModal({
    open,
    onConfirm,
    onCancel,
    onNavigate,
    state,
    existingNextChatId,
    error,
}: ContextHardStopModalProps) {
    const isForcing = state === 'forcing';
    const isAlreadyTransitioned = state === 'already-transitioned';

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen && !isForcing) onCancel();
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Context limit reached</DialogTitle>
                    <DialogDescription>
                        {isAlreadyTransitioned
                            ? 'This phase has reached the context limit and cannot continue. A next phase already exists, so a new Completion Brief / phase transition cannot be started from here.'
                            : 'You have reached the context limit for this phase. Would you like to create a Completion Brief and move to the next phase?'}
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}
                <DialogFooter>
                    {isAlreadyTransitioned ? (
                        existingNextChatId ? (
                            <Button onClick={onNavigate ?? onCancel}>Go to next phase</Button>
                        ) : (
                            <Button variant="outline" onClick={onCancel}>
                                Close
                            </Button>
                        )
                    ) : (
                        <>
                            <Button variant="outline" onClick={onCancel} disabled={isForcing}>
                                Cancel
                            </Button>
                            <Button onClick={onConfirm} disabled={isForcing}>
                                {isForcing ? (
                                    <>
                                        <Loader2 className="size-4 animate-spin" />
                                        Working…
                                    </>
                                ) : (
                                    'Yes, create Completion Brief'
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
