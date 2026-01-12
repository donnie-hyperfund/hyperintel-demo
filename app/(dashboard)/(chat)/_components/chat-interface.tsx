"use client"

import { useState, useRef, useEffect } from "react"
import { useAuth } from "@clerk/nextjs"
import ChatConversation, { type Message } from "./chat-conversation/chat-conversation"
import ChatMessageForm from "./chat-message-form"
import type { ChatMessageFormValues } from "./chat-message-form/schema"
import { MOCK_MESSAGES } from "@/app/(dashboard)/(chat)/_components/mock"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { Button } from "@/components/ui/button"
import { sendAction } from "@/lib/api/requests/worker/chat"

type Conversation = {
  id: string
  messages: Message[]
  isLoading: boolean
}

export default function ChatInterface() {
  const { getToken } = useAuth()
  const chatConversationRef = useRef<HTMLDivElement>(null)
  const chatMessageFormRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const formElement = chatMessageFormRef.current
    const conversationElement = chatConversationRef.current

    if (!formElement || !conversationElement) return

    const updatePadding = () => {
      const height = formElement.offsetHeight
      console.log(height)
      conversationElement.style.paddingBottom = `${height + 16}px`
    }

    updatePadding()

    const resizeObserver = new ResizeObserver(updatePadding)
    resizeObserver.observe(formElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "left",
      messages: MOCK_MESSAGES,
      isLoading: false,
    },
    {
      id: "right",
      messages: [
        {
          role: "assistant",
          content: "```tsx\n// components/ui/button.tsx\nimport { cn } from '@/lib/utils'\n\ninterface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'primary' | 'secondary' | 'outline'\n  size?: 'sm' | 'md' | 'lg'\n}\n\nexport const Button = ({ \n  variant = 'primary', \n  size = 'md',\n  className,\n  children,\n  ...props \n}: ButtonProps) => {\n  return (\n    <button\n      className={cn(\n        'rounded-lg font-medium transition-colors',\n        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',\n        variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n        variant === 'outline' && 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',\n        size === 'sm' && 'px-3 py-1.5 text-sm',\n        size === 'md' && 'px-4 py-2',\n        size === 'lg' && 'px-6 py-3 text-lg',\n        className\n      )}\n      {...props}\n    >\n      {children}\n    </button>\n  )\n}\n```",
          id: "1",
        },
      ],
      isLoading: false,
    },
  ])

  const [artifactContent, setArtifactContent] = useState<string>("")
  const [artifactRaw, setArtifactRaw] = useState<string>("")
  const [isStreamingArtifact, setIsStreamingArtifact] = useState(false)
  const [streamedText, setStreamedText] = useState<string>("")

  const handleSend = async (data: ChatMessageFormValues) => {
    if (!data.message.trim()) return

    const userMessage: Message = {
      role: "user",
      content: data.message,
      id: "13",
    }

    // Add user message to both conversations
    setConversations((prev) =>
      prev.map((conv) => ({
        ...conv,
        messages: [...conv.messages, userMessage],
        isLoading: true,
      })),
    )

    // Get access token for worker auth
    const accessToken = await getToken() ?? ""

    // Send to worker (or local endpoint based on env)
    try {
      const responses = await Promise.all([
        sendAction({
          messages: [...conversations[0].messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          conversationId: "left",
        }, accessToken),
        sendAction({
          messages: [...conversations[1].messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          conversationId: "right",
        }, accessToken),
      ])

      const [leftData, rightData] = await Promise.all([responses[0].json(), responses[1].json()])

      setConversations((prev) => [
        {
          ...prev[0],
          messages: [
            ...prev[0].messages,
            { role: "assistant", content: leftData.message, id: `${Date.now()}-left` },
          ],
          isLoading: false,
        },
        {
          ...prev[1],
          messages: [
            ...prev[1].messages,
            { role: "assistant", content: rightData.message, id: `${Date.now()}-right` },
          ],
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

  const handleStreamArtifact = async () => {
    setIsStreamingArtifact(true)
    setStreamedText("")
    setArtifactContent("")
    setArtifactRaw("")

    try {
      const response = await fetch("/api/stream-artifact", {
        method: "GET",
      })

      if (!response.body) {
        throw new Error("No response body")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") {
              setIsStreamingArtifact(false)
              return
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === "text") {
                // Add streamed text to left conversation
                setConversations((prev) => {
                  const newMessages = [...prev[0].messages]
                  const lastMessage = newMessages[newMessages.length - 1]
                  if (lastMessage && lastMessage.role === "assistant" && lastMessage.id === "streaming") {
                    newMessages[newMessages.length - 1] = {
                      ...lastMessage,
                      content: lastMessage.content + parsed.content,
                    }
                  } else {
                    newMessages.push({
                      role: "assistant",
                      content: parsed.content,
                      id: "streaming",
                    })
                  }
                  return [
                    {
                      ...prev[0],
                      messages: newMessages,
                    },
                    prev[1],
                  ]
                })
                setStreamedText((prev) => prev + parsed.content)
              } else if (parsed.type === "artifact_start") {
                setArtifactRaw(parsed.raw)
                setArtifactContent("")
                setConversations((prev) => {
                  const streamingMessage = prev[0].messages.find((msg) => msg.id === "streaming")
                  const newMessages = prev[0].messages.filter((msg) => msg.id !== "streaming")
                  if (streamingMessage) {
                    newMessages.push({
                      role: "assistant",
                      content: streamingMessage.content,
                      id: `${Date.now()}-left`,
                    })
                  }
                  return [
                    {
                      ...prev[0],
                      messages: newMessages,
                    },
                    prev[1],
                  ]
                })
              } else if (parsed.type === "artifact_chunk") {
                setArtifactContent((prev) => prev + parsed.content)
              } else if (parsed.type === "artifact_end") {
                setIsStreamingArtifact(false)
              } else if (parsed.type === "error") {
                console.error("Stream error:", parsed.error)
                setIsStreamingArtifact(false)
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e)
            }
          }
        }
      }
    } catch (error) {
      console.error("Error streaming artifact:", error)
      setIsStreamingArtifact(false)
    }
  }

  return (
    <ResizablePanelGroup 
      direction="horizontal" 
      className="h-full"
    >
      {/* Chat Panel */}
      <ResizablePanel defaultSize={75} minSize={40} maxSize={80}>
        <div className="bg-card flex flex-col border-r border-border relative h-full">
          <ChatConversation
            messages={conversations[0].messages}
            isLoading={conversations[0].isLoading}
            ref={chatConversationRef}
          />

          <ChatMessageForm ref={chatMessageFormRef} onSubmit={handleSend} className="absolute bottom-0 left-0 right-0"/>
        </div>
      </ResizablePanel>

      <ResizableHandle 
        className="w-1 bg-border hover:bg-primary/50 transition-colors"
      />

      {/* Artifacts Panel */}
      <ResizablePanel defaultSize={25} minSize={20}>
        <div className="bg-card flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-border">
            <Button 
              onClick={handleStreamArtifact} 
              disabled={isStreamingArtifact}
              className="w-full"
            >
              {isStreamingArtifact ? "Streaming..." : "Test Stream Artifact"}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {artifactContent ? (
              <div 
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: artifactContent }}
              />
            ) : (
              <div className="text-muted-foreground text-center py-8">
                {isStreamingArtifact 
                  ? "Streaming artifact..." 
                  : "Click the button above to test the artifact stream"}
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
