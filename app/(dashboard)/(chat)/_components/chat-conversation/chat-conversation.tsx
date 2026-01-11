"use client"

import { forwardRef } from "react"
import { Loader2, Layers } from "lucide-react"
import MessagesList from "./messages-list"

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

type ChatConversationProps = {
  messages: Message[]
  isLoading: boolean
  emptyState?: {
    icon?: React.ReactNode
    title?: string
    description?: string
  }
}

const ChatConversation = forwardRef<HTMLDivElement, ChatConversationProps>(
  ({ messages, isLoading, emptyState }, ref) => {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto p-6">
      <div className="w-full max-w-4xl mx-auto space-y-4 min-w-0">
      {messages.length === 0 && !isLoading && (
        <div className="h-full flex items-center justify-center">
          {emptyState ? (
            <div className="text-center space-y-3 max-w-sm">
              {emptyState.icon || (
                <div className="w-16 h-16 mx-auto bg-muted rounded-lg flex items-center justify-center">
                  <Layers className="w-8 h-8 text-muted-foreground/50" />
                </div>
              )}
              <div className="space-y-1">
                <p className="text-lg font-medium text-foreground">
                  {emptyState.title || "Artifact Preview"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {emptyState.description || "Generated artifacts will appear here"}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <div className="text-4xl">💬</div>
              <p className="text-muted-foreground">Start a conversation</p>
            </div>
          )}
        </div>
      )}

      <MessagesList messages={messages} />

      {isLoading && (
        <div className="flex gap-3 justify-start">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
          </div>
          <div className="max-w-[80%] rounded-lg px-4 py-2 text-sm bg-muted">
            <div className="flex gap-1">
              <span
                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
    )
  },
)

ChatConversation.displayName = "ChatConversation"

export default ChatConversation

