type ListPageWrapperProps = {
    HeaderComponent: React.ReactNode;
    children: React.ReactNode;
};

export function ListPageWrapper({ HeaderComponent, children }: ListPageWrapperProps) {
    return (
        <div className="flex min-h-full w-full flex-col">
            {HeaderComponent}
            <div className="flex flex-1 px-4 pb-12 pt-4">
                <div className="mx-auto w-full max-w-3xl flex flex-col gap-4">{children}</div>
            </div>
        </div>
    );
}
