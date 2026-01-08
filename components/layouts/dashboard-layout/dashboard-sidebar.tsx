"use client"

import { useState } from "react"
import { MessageSquare, Code, Layers, FileCode } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { icon: MessageSquare, label: "Chats", active: true },
  { icon: Layers, label: "Artifacts" },
  { icon: FileCode, label: "Projects" },
  { icon: Code, label: "Code" },
]

const projectNames = ["Project Name Goes Here", "Project Name Goes Here", "Project Name Goes Here"]

export function DashboardSidebar() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [username] = useState("Username")

  return (
    <aside
      className={cn(
        "bg-sidebar border-r border-sidebar-border flex flex-col py-6 transition-all duration-300 ease-in-out",
        sidebarExpanded ? "w-64 px-4" : "w-16 px-3",
      )}
      onMouseEnter={() => setSidebarExpanded(true)}
      onMouseLeave={() => setSidebarExpanded(false)}
    >
      <div
        className={cn(
          "flex items-center mb-6 transition-all duration-300",
          sidebarExpanded ? "justify-start gap-3 px-2" : "justify-center",
        )}
      >
        <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg shrink-0">
          <span className="text-sm font-bold text-primary-foreground">H</span>
        </div>
        {sidebarExpanded && (
          <span className="text-lg font-semibold whitespace-nowrap">
            HYPER<span className="text-primary">INTEL</span>
            <sup className="text-[10px] align-super">™</sup>
          </span>
        )}
      </div>

      <nav className="flex flex-col gap-2 flex-1">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={cn(
              "flex items-center rounded-lg transition-colors h-10",
              sidebarExpanded ? "gap-3 px-3 justify-start" : "justify-center",
              item.active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
            title={item.label}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {sidebarExpanded && <span className="text-sm">{item.label}</span>}
          </button>
        ))}
      </nav>

      {sidebarExpanded && (
        <div className="mb-4 space-y-2">
          {projectNames.map((name, idx) => (
            <div
              key={idx}
              className="text-xs text-sidebar-foreground/60 px-3 py-1.5 hover:bg-sidebar-accent/30 rounded cursor-pointer transition-colors truncate"
            >
              {name}
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          "flex items-center transition-all duration-300",
          sidebarExpanded ? "justify-start gap-3 px-2" : "justify-center",
        )}
      >
        <div className="flex items-center justify-center w-10 h-10 bg-muted rounded-full text-xs font-medium shrink-0">
          {username.charAt(0).toUpperCase()}
        </div>
        {sidebarExpanded && <span className="text-sm truncate">{username}</span>}
      </div>
    </aside>
  )
}

