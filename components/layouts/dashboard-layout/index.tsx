'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';

type DashboardLayoutProps = {
    children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <SidebarProvider>
            <DashboardSidebar />
            <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
    );
}
