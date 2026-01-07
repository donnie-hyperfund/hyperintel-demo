"use client"

import { useState, useRef, useEffect } from "react"
import { MessageSquare, Code, Layers, FileCode } from "lucide-react"
import { cn } from "@/lib/utils"
import ChatConversation, { type Message } from "./chat-conversation/chat-conversation"
import ChatMessageForm from "./chat-message-form"
import type { ChatMessageFormValues } from "./chat-message-form/schema"

type Conversation = {
  id: string
  messages: Message[]
  isLoading: boolean
}

const navItems = [
  { icon: MessageSquare, label: "Chats", active: true },
  { icon: Layers, label: "Artifacts" },
  { icon: FileCode, label: "Projects" },
  { icon: Code, label: "Code" },
]

const projectNames = ["Project Name Goes Here", "Project Name Goes Here", "Project Name Goes Here"]

export default function ChatInterface() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [username, setUsername] = useState("Username")
  const [leftPanelWidth, setLeftPanelWidth] = useState(50) // percentage
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = () => {
    setIsResizing(true)
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

    // Constrain between 20% and 80%
    if (newLeftWidth >= 20 && newLeftWidth <= 80) {
      setLeftPanelWidth(newLeftWidth)
    }
  }

  const handleMouseUp = () => {
    setIsResizing(false)
  }

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove as any)
      document.addEventListener("mouseup", handleMouseUp)
    } else {
      document.removeEventListener("mousemove", handleMouseMove as any)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove as any)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing])

  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "left",
      messages: [
        {
          role: "user",
          content: "Hello! Can you help me build a React component?",
        },
        {
          role: "assistant",
          content: "Of course! I'd be happy to help you build a React component. What kind of component are you looking to create?",
        },
        {
          role: "user",
          content: "I need a button component with different variants like primary, secondary, and outline.",
        },
        {
          role: "assistant",
          content: "Great! I can help you create a flexible button component. Here's a basic structure:\n\n```tsx\ninterface ButtonProps {\n  variant?: 'primary' | 'secondary' | 'outline'\n  children: React.ReactNode\n  onClick?: () => void\n}\n\nconst Button = ({ variant = 'primary', children, onClick }: ButtonProps) => {\n  const baseStyles = 'px-4 py-2 rounded-lg font-medium transition-colors'\n  const variantStyles = {\n    primary: 'bg-blue-600 text-white hover:bg-blue-700',\n    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50'\n  }\n  \n  return (\n    <button\n      className={`${baseStyles} ${variantStyles[variant]}`}\n      onClick={onClick}\n    >\n      {children}\n    </button>\n  )\n}\n```\n\nWould you like me to add any additional features like disabled states, sizes, or icons?",
        },
        {
          role: "user",
          content: "Hello! Can you help me build a React component?",
        },
        {
          role: "assistant",
          content: "Of course! I'd be happy to help you build a React component. What kind of component are you looking to create?",
        },
        {
          role: "user",
          content: "I need a button component with different variants like primary, secondary, and outline.",
        },
        {
          role: "assistant",
          content: "Great! I can help you create a flexible button component. Here's a basic structure:\n\n```tsx\ninterface ButtonProps {\n  variant?: 'primary' | 'secondary' | 'outline'\n  children: React.ReactNode\n  onClick?: () => void\n}\n\nconst Button = ({ variant = 'primary', children, onClick }: ButtonProps) => {\n  const baseStyles = 'px-4 py-2 rounded-lg font-medium transition-colors'\n  const variantStyles = {\n    primary: 'bg-blue-600 text-white hover:bg-blue-700',\n    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50'\n  }\n  \n  return (\n    <button\n      className={`${baseStyles} ${variantStyles[variant]}`}\n      onClick={onClick}\n    >\n      {children}\n    </button>\n  )\n}\n```\n\nWould you like me to add any additional features like disabled states, sizes, or icons?",
        },
        {
          role: "user",
          content: "Hello! Can you help me build a React component?",
        },
        {
          role: "assistant",
          content: "Of course! I'd be happy to help you build a React component. What kind of component are you looking to create?",
        },
        {
          role: "user",
          content: "I need a button component with different variants like primary, secondary, and outline.",
        },
        {
          role: "assistant",
          content: "Great! I can help you create a flexible button component. Here's a basic structure:\n\n```tsx\ninterface ButtonProps {\n  variant?: 'primary' | 'secondary' | 'outline'\n  children: React.ReactNode\n  onClick?: () => void\n}\n\nconst Button = ({ variant = 'primary', children, onClick }: ButtonProps) => {\n  const baseStyles = 'px-4 py-2 rounded-lg font-medium transition-colors'\n  const variantStyles = {\n    primary: 'bg-blue-600 text-white hover:bg-blue-700',\n    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50'\n  }\n  \n  return (\n    <button\n      className={`${baseStyles} ${variantStyles[variant]}`}\n      onClick={onClick}\n    >\n      {children}\n    </button>\n  )\n}\n```\n\nWould you like me to add any additional features like disabled states, sizes, or icons?",
        },
      ],
      isLoading: false,
    },
    {
      id: "right",
      messages: [
        {
          role: "assistant",
          content: "```tsx\n// components/ui/button.tsx\nimport { cn } from '@/lib/utils'\n\ninterface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'primary' | 'secondary' | 'outline'\n  size?: 'sm' | 'md' | 'lg'\n}\n\nexport const Button = ({ \n  variant = 'primary', \n  size = 'md',\n  className,\n  children,\n  ...props \n}: ButtonProps) => {\n  return (\n    <button\n      className={cn(\n        'rounded-lg font-medium transition-colors',\n        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',\n        variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n        variant === 'outline' && 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',\n        size === 'sm' && 'px-3 py-1.5 text-sm',\n        size === 'md' && 'px-4 py-2',\n        size === 'lg' && 'px-6 py-3 text-lg',\n        className\n      )}\n      {...props}\n    >\n      {children}\n    </button>\n  )\n}\n```",
        },
      ],
      isLoading: false,
    },
  ])

  const handleSend = async (data: ChatMessageFormValues) => {
    if (!data.message.trim()) return

    const userMessage: Message = {
      role: "user",
      content: data.message,
    }

    // Add user message to both conversations
    setConversations((prev) =>
      prev.map((conv) => ({
        ...conv,
        messages: [...conv.messages, userMessage],
        isLoading: true,
      })),
    )

    // Simulate AI responses for both panels
    try {
      const responses = await Promise.all([
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...conversations[0].messages, userMessage],
            conversationId: "left",
          }),
        }),
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...conversations[1].messages, userMessage],
            conversationId: "right",
          }),
        }),
      ])

      const [leftData, rightData] = await Promise.all([responses[0].json(), responses[1].json()])

      setConversations((prev) => [
        {
          ...prev[0],
          messages: [...prev[0].messages, { role: "assistant", content: leftData.message }],
          isLoading: false,
        },
        {
          ...prev[1],
          messages: [...prev[1].messages, { role: "assistant", content: rightData.message }],
          isLoading: false,
        },
      ])
    } catch (error) {
      console.error("Error fetching responses:", error)
      setConversations((prev) =>
        prev.map((conv) => ({
          ...conv,
          isLoading: false,
        })),
      )
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">
              HYPER<span className="text-primary">INTEL</span>
              <sup className="text-[10px] align-super">™</sup>
            </span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="text-sm text-muted-foreground">Project Name / Chat Name</div>
          </div>
        </header>

        {/* Chat Panels */}
        <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
          {/* Left Panel */}
          <div className="bg-card flex flex-col border-r border-border relative" style={{ width: `${leftPanelWidth}%` }}>
            <ChatConversation
              messages={conversations[0].messages}
              isLoading={conversations[0].isLoading}
              username={username}
            />

            <ChatMessageForm onSubmit={handleSend} className="absolute bottom-0 left-0 right-0"/>
          </div>

          {/* Resize Handle */}
          <div
            className={cn(
              "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors relative group",
              isResizing && "bg-primary",
            )}
            onMouseDown={handleMouseDown}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>

          {/* Right Panel */}
          <div className="bg-card flex flex-col flex-1" style={{ width: `${100 - leftPanelWidth}%` }}>
            {/* TODO: Add right panel content */}
          </div>
        </div>
      </div>
    </div>
  )
}
