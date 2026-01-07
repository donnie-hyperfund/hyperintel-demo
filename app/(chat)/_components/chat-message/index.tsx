"use client"

import { cn } from "@/lib/utils"
import type { Message } from "../chat-conversation/chat-conversation"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"

type ChatMessageProps = {
  message: Message
  username: string
}

export default function ChatMessage({ message, username }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="max-w-[90%] rounded-4 py-3 px-4 bg-neutral-800 text-foreground justify-self-end">
        <MarkdownRenderer markdown={message.content} />
      </div>
    )
  }
  return (
    <div className="max-w-[90%]">
      <MarkdownRenderer markdown={message.content} />
    </div>
  )
}

