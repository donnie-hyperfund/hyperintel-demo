"use client"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { DashboardSidebar } from "./dashboard-sidebar"
import { DashboardHeader } from "./dashboard-header"

type DashboardLayoutProps = {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full">
        <DashboardSidebar />
        <SidebarInset className="flex flex-col">
          <DashboardHeader />
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

