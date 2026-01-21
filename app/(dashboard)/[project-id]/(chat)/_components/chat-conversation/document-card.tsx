type DocumentCardProps = {
    name: string;
    version?: number;
    action?: string;
};

export function DocumentCard({ name, version, action }: DocumentCardProps) {
    const icon = action === 'created' ? '📄' : action === 'replaced' ? '📝' : '✏️';

    return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg text-sm mt-2">
            <span>{icon}</span>
            <span className="font-medium">{name}</span>
            {version && <span className="text-muted-foreground">v{version}</span>}
        </div>
    );
}
