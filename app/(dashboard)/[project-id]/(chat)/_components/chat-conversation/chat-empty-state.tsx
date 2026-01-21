import { Layers } from 'lucide-react';

export type ChatEmptyStateProps = {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
};

export function ChatEmptyState({ icon, title, description }: ChatEmptyStateProps) {
    if (icon || title || description) {
        return (
            <div className="text-center space-y-3 max-w-sm">
                {icon || (
                    <div className="w-16 h-16 mx-auto bg-muted rounded-lg flex items-center justify-center">
                        <Layers className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                )}
                <div className="space-y-1">
                    <p className="text-lg font-medium text-foreground">{title || 'Artifact Preview'}</p>
                    <p className="text-sm text-muted-foreground">
                        {description || 'Generated artifacts will appear here'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="text-center space-y-2">
            <div className="text-4xl">💬</div>
            <p className="text-muted-foreground">Start a conversation</p>
        </div>
    );
}
