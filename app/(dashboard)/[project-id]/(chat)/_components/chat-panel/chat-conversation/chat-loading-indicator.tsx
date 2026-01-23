import { Loader2 } from 'lucide-react';
import { TypingIndicator } from './typing-indicator';

export function ChatLoadingIndicator() {
    return (
        <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
            </div>
            <div className="max-w-[80%] rounded-lg px-4 py-2 text-sm bg-muted">
                <TypingIndicator />
            </div>
        </div>
    );
}
