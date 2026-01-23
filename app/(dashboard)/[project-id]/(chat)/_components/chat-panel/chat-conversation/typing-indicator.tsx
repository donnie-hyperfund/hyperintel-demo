export function TypingIndicator() {
    return (
        <div className="flex gap-1">
            <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span
                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
            />
            <span
                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
            />
        </div>
    );
}
