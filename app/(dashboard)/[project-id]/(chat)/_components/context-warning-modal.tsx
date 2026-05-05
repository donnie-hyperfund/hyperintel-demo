'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type ContextWarningModalProps = {
    open: boolean;
    onContinue: (dontRemindAgain: boolean) => void;
    onNextPhase: () => void;
    onCancel: () => void;
};

export function ContextWarningModal({ open, onContinue, onNextPhase, onCancel }: ContextWarningModalProps) {
    const [dontRemindAgain, setDontRemindAgain] = useState(false);

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) onCancel();
    };

    const handleContinue = () => {
        onContinue(dontRemindAgain);
        setDontRemindAgain(false);
    };

    const handleNextPhase = () => {
        setDontRemindAgain(false);
        onNextPhase();
    };

    const handleCancel = () => {
        setDontRemindAgain(false);
        onCancel();
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Approaching context limit</DialogTitle>
                    <DialogDescription>
                        You are approaching context window limits, quality can deteriorate, do you want to continue or
                        generate completion brief and go to next phase? If you continue a completion brief may be forced
                        at some point if you exceed context capacity.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 py-1">
                    <Checkbox
                        id="dont-remind-again"
                        checked={dontRemindAgain}
                        onCheckedChange={(checked) => setDontRemindAgain(checked === true)}
                    />
                    <Label htmlFor="dont-remind-again" className="cursor-pointer text-sm font-normal">
                        don&apos;t remind me again this session
                    </Label>
                </div>
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button variant="outline" onClick={handleNextPhase}>
                        Next phase
                    </Button>
                    <Button onClick={handleContinue}>Continue</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
