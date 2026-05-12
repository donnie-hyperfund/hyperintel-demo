import { Loader2 } from 'lucide-react';

export function ChatLoader() {
    return (
        <div className="flex flex-col" style={{ height: 'calc(100dvh - var(--processing-bar-height, 0px))' }}>
            <div className="h-[57px] shrink-0" />
            <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
            <div className="h-[126px] shrink-0" />
        </div>
    );
}
