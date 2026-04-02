import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUpdateChatName } from '@/lib/api/client/hooks/use-chats';

type RenamePhaseDialogProps = {
    chatId: string | null;
    initialName: string;
    onClose: () => void;
    onSaved: () => void;
};

export const RenamePhaseDialog = ({ chatId, initialName, onClose, onSaved }: RenamePhaseDialogProps) => {
    const [nameValue, setNameValue] = useState(initialName);
    const inputRef = useRef<HTMLInputElement>(null);
    const { trigger: updateName, isMutating } = useUpdateChatName(chatId ?? '');

    const handleSave = async () => {
        if (!chatId || !nameValue.trim()) return;
        await updateName(nameValue.trim());
        onSaved();
    };

    return (
        <Dialog open={!!chatId} onOpenChange={(v) => !v && onClose()}>
            <DialogContent showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>Rename phase</DialogTitle>
                    <DialogDescription>Give this phase a name to help you identify it later.</DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSave();
                    }}
                >
                    <Input
                        ref={inputRef}
                        autoFocus
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        placeholder="Phase name"
                        maxLength={100}
                    />
                    <DialogFooter className="mt-4">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!nameValue.trim() || isMutating}>
                            {isMutating ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
