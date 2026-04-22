import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ListPageHeaderProps = {
    title: string;
    ActionComponent?: React.ReactNode;
    BackComponent?: React.ReactNode;
};

export function ListPageHeader({ title, ActionComponent, BackComponent }: ListPageHeaderProps) {
    return (
        <div className="sticky top-(--processing-bar-height,0px) z-10 bg-neutral-975 px-4">
            <div className="mx-auto w-full max-w-3xl">
                {/* Desktop */}
                <div className="hidden md:flex flex-col items-start pb-6 pt-12 gap-2.5">
                    {BackComponent}
                    <div className="flex items-center justify-between self-stretch">
                        <h1 className="text-2xl font-semibold">{title}</h1>
                        {ActionComponent}
                    </div>
                </div>
                {/* Mobile */}
                <div className="flex flex-col md:hidden pt-4 pb-4 gap-4">
                    <div className="flex items-center justify-between">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <SidebarTrigger className="size-8 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>Toggle sidebar</TooltipContent>
                        </Tooltip>
                        {ActionComponent}
                    </div>
                    <div className="flex flex-col items-start gap-2.5">
                        {BackComponent}
                        <h1 className="text-xl font-semibold">{title}</h1>
                    </div>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 -bottom-4 h-4 bg-linear-to-b from-neutral-975/60 to-transparent" />
        </div>
    );
}
