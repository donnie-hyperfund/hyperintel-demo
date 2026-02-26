type ListPageHeaderProps = {
    title: string;
    ActionComponent?: React.ReactNode;
};

export function ListPageHeader({ title, ActionComponent }: ListPageHeaderProps) {
    return (
        <div className="sticky top-0 z-10 bg-neutral-975 px-4">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between pb-6 pt-12">
                <h1 className="text-2xl font-semibold">{title}</h1>
                {ActionComponent}
            </div>
            <div className="pointer-events-none absolute inset-x-0 -bottom-4 h-4 bg-linear-to-b from-neutral-975/60 to-transparent" />
        </div>
    );
}
