'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';

type DashboardLayoutProps = {
    children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <SidebarProvider>
            <div className="flex h-dvh w-full">
                <DashboardSidebar />
                <SidebarInset className="flex flex-1 overflow-hidden bg-neutral-975">{children}</SidebarInset>
            </div>
        </SidebarProvider>
    );
}
