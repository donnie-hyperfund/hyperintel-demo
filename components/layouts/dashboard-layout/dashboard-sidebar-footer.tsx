'use client';

import { useUser } from '@clerk/nextjs';
import { useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/hooks/use-sign-out';
import { cn } from '@/lib/utils';

type DashboardSidebarFooterProps = {
    isExpanded: boolean;
};

export function DashboardSidebarFooter({ isExpanded }: DashboardSidebarFooterProps) {
    // TODO: Use useFetchUser API hook here
    const { user } = useUser();
    const { signOut } = useSignOut();
    const buttonRef = useRef<HTMLButtonElement>(null);

    const name = user?.fullName || user?.firstName || user?.lastName || 'User';
    const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || '';
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    return (
        <DropdownMenu
            onOpenChange={(open) => {
                if (!open && buttonRef.current) {
                    buttonRef.current.blur();
                }
            }}
        >
            <DropdownMenuTrigger asChild>
                <button
                    ref={buttonRef}
                    type="button"
                    className={cn(
                        'w-full flex items-center transition-all duration-300 rounded-2.5 px-2 py-2 text-left',
                        'hover:bg-neutral-850/40 data-[state=open]:bg-neutral-850/40',
                        'focus:outline-none focus-visible:ring-neutral-700 focus-visible:ring-2',
                        isExpanded ? 'justify-start gap-3' : 'justify-center',
                    )}
                >
                    <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-neutral-100/10 text-neutral-400 text-xs font-medium">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    {isExpanded && (
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-medium truncate text-neutral-100">{name}</span>
                            <span className="text-xs text-neutral-500 truncate">Free plan</span>
                        </div>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <div className="px-2 py-1.5">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{email}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={(e) => {
                        e.preventDefault();
                        signOut();
                    }}
                >
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
