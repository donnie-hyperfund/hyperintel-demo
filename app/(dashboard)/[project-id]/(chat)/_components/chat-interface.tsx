"use client"

import { useState, useRef, useEffect } from "react"
import { useAuth } from "@clerk/nextjs"
import ChatConversation, { type Message } from "./chat-conversation/chat-conversation"
import ChatMessageForm from "./chat-message-form"
import type { ChatMessageFormValues } from "./chat-message-form/schema"

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { sendAction } from "@/lib/api/requests/worker/chat"

export default function ChatInterface() {
  const { getToken } = useAuth()
  const chatConversationRef = useRef<HTMLDivElement>(null)
  const chatMessageFormRef = useRef<HTMLFormElement>(null)

  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)

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

  // Fetch chat history on mount
  useEffect(() => {
    const fetchChat = async () => {
      try {
        const res = await fetch("/api/chat")
        if (res.ok) {
          const data = await res.json()
          setChatId(data.chatId)
          setMessages(data.messages || [])
        }
      } catch (error) {
        console.error("Error fetching chat:", error)
      } finally {
        setIsInitialLoading(false)
      }
    }
    fetchChat()
  }, [])

  // Stream reader for SSE responses from worker
  const readStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    // Add empty assistant message to start streaming into
    setMessages((prev) => [
      ...prev,
      { id: `streaming-${Date.now()}`, role: "assistant" as const, content: "" },
    ])

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const jsonString = line.replace("data: ", "").trim()
        if (jsonString === "[DONE]") continue

        try {
          const json = JSON.parse(jsonString)

          if (json.error) {
            console.error("Stream error:", json.error)
            break
          }

          switch (json.type) {
            case "delta":
              // Append text chunk to last assistant message
              if (json.text) {
                // console.log("Delta received:", JSON.stringify(json.text))
                setMessages((prev) => {
                  const lastIdx = prev.length - 1
                  const lastMsg = prev[lastIdx]
                  if (lastMsg?.role === "assistant") {
                    return [
                      ...prev.slice(0, lastIdx),
                      { ...lastMsg, content: lastMsg.content + json.text }
                    ]
                  }
                  return prev
                })
              }
              break

            case "created":
              // Update message ID from server
              if (json.id) {
                setMessages((prev) => {
                  const msgs = [...prev]
                  const lastMsg = msgs[msgs.length - 1]
                  if (lastMsg?.id?.startsWith("streaming-")) {
                    lastMsg.id = json.id
                  }
                  return msgs
                })
              }
              break

            case "state":
              // TODO: Handle conversation state changes (intake, generating, finished)
              console.log("State change:", json.state)
              break

            case "synthetic":
              // TODO: Handle synthetic/typewriter-effect messages
              console.log("Synthetic message:", json.text)
              break

            case "web_search_starting":
              // TODO: Show web search indicator
              console.log("Web search started")
              break

            case "web_search_done":
              // TODO: Hide web search indicator
              console.log("Web search done")
              break

            case "preview-ready":
              // TODO: Handle preview ready notification
              console.log("Preview ready:", json.data?.isReady)
              break

            case "action":
              // TODO: Handle action events (edit-proposal, etc.)
              console.log("Action:", json.data?.type)
              break

            default:
              console.log("Unknown event type:", json.type)
          }
        } catch (e) {
          console.error("Failed to parse SSE data:", e)
        }
      }
    }

    setIsLoading(false)
  }

  // Artifact state (separate from messages)
  const [artifactContent, setArtifactContent] = useState<string>("")
  const [artifactRaw, setArtifactRaw] = useState<string>("")
  const [isStreamingArtifact, setIsStreamingArtifact] = useState(false)

  const handleSend = async (data: ChatMessageFormValues) => {
    if (!data.message.trim()) return

    const userMessage: Message = {
      role: "user",
      content: data.message,
      id: `user-${Date.now()}`,
    }

    // Add user message
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    // Get access token for worker auth
    const accessToken = await getToken() ?? ""

    try {
      if (!chatId) {
        console.error("No chat ID available")
        setIsLoading(false)
        return
      }
      const response = await sendAction({
        message: data.message,
        chatId,
      }, accessToken)

      // Use streaming response
      if (response.body) {
        await readStream(response.body)
      }
      setIsLoading(false)
    } catch (error) {
      console.error("Error fetching response:", error)
      setIsLoading(false)
    }
  }

  const handleStreamArtifact = async () => {
    setIsStreamingArtifact(true)
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
                // Text goes to messages if we want, or ignore for now
              } else if (parsed.type === "artifact_start") {
                setArtifactRaw(parsed.raw)
                setArtifactContent("")
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
            messages={messages}
            isLoading={isLoading}
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
