"use client"

import type { Message } from "../chat-conversation/chat-conversation"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"

type ChatMessageProps = {
  message: Message
}

export default function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="max-w-[90%] min-w-0 rounded-4 py-3 px-4 bg-neutral-800 text-foreground justify-self-end">
        <div className="min-w-0">
          <MarkdownRenderer markdown={message.content} />
        </div>
      </div>
    )
  }
  return (
    <div className="max-w-[90%] min-w-0">
      <div className="min-w-0">
        <MarkdownRenderer markdown={message.content} />
      </div>
    </div>
  )
}

