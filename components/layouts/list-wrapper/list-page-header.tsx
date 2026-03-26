import { SidebarTrigger } from '@/components/ui/sidebar';

type ListPageHeaderProps = {
    title: string;
    ActionComponent?: React.ReactNode;
};

export function ListPageHeader({ title, ActionComponent }: ListPageHeaderProps) {
    return (
        <div className="sticky top-0 z-10 bg-neutral-975 px-4">
            <div className="mx-auto w-full max-w-3xl">
                {/* Mobile */}
                <div className="hidden md:flex items-center justify-between pb-6 pt-12">
                    <h1 className="text-2xl font-semibold">{title}</h1>
                    {ActionComponent}
                </div>
                {/* Desktop */}
                <div className="flex flex-col md:hidden pt-4 pb-4 gap-4">
                    <div className="flex items-center justify-between">
                        <SidebarTrigger className="size-8 shrink-0" />
                        {ActionComponent}
                    </div>
                    <h1 className="text-xl font-semibold">{title}</h1>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 -bottom-4 h-4 bg-linear-to-b from-neutral-975/60 to-transparent" />
        </div>
    );
}
