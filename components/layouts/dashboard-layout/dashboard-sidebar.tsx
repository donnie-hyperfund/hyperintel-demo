"use client"

import { useState } from "react"
import { MessageSquare, Code, Layers, FileCode } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const navItems = [
  { icon: MessageSquare, label: "Chats", active: true },
  { icon: Layers, label: "Artifacts" },
  { icon: FileCode, label: "Projects" },
  { icon: Code, label: "Code" },
]

const projectNames = ["Project Name Goes Here", "Project Name Goes Here", "Project Name Goes Here"]

export function DashboardSidebar() {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const [username] = useState("Username")
  const [isHovered, setIsHovered] = useState(false)
  const isExpanded = !isCollapsed || isHovered

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SidebarHeader className="p-2">
        <div
          className={cn(
            "flex items-center transition-all duration-300",
            isExpanded ? "justify-start gap-3 px-2" : "justify-center",
          )}
        >
          <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg shrink-0">
            <span className="text-sm font-bold text-primary-foreground">H</span>
          </div>
          {isExpanded && (
            <span className="text-lg font-semibold whitespace-nowrap text-sidebar-foreground">
              HYPER<span className="text-primary">INTEL</span>
              <sup className="text-[10px] align-super">™</sup>
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={item.active}
                      tooltip={isCollapsed && !isHovered ? item.label : undefined}
                      className={cn(
                        item.active && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isExpanded && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <div className="space-y-1 px-2">
                {projectNames.map((name, idx) => (
                  <button
                    key={idx}
                    className="w-full text-xs text-sidebar-foreground/60 px-2 py-1.5 hover:bg-sidebar-accent/30 rounded cursor-pointer transition-colors truncate text-left"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2">
        <div
          className={cn(
            "flex items-center transition-all duration-300",
            isExpanded ? "justify-start gap-3 px-2" : "justify-center",
          )}
        >
          <div className="flex items-center justify-center w-10 h-10 bg-muted rounded-full text-xs font-medium shrink-0 text-foreground">
            {username.charAt(0).toUpperCase()}
          </div>
          {isExpanded && (
            <span className="text-sm truncate text-sidebar-foreground">{username}</span>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

