"use client"

import { useRef, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { AutoExpandingTextarea, type AutoExpandingTextareaRef } from "@/components/ui/auto-expanding-textarea"
import { chatMessageFormSchema, type ChatMessageFormValues } from "./schema"
import { cn } from "@/lib/utils"
import { Send } from "lucide-react"

type ChatMessageFormProps = {
  onSubmit: (data: ChatMessageFormValues) => void
  className?: string
}

export default function ChatMessageForm({ onSubmit, className }: ChatMessageFormProps) {
  const textareaRef = useRef<AutoExpandingTextareaRef>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ChatMessageFormValues>({
    resolver: zodResolver(chatMessageFormSchema),
    defaultValues: {
      message: "",
    },
  })

  const message = watch("message")
  const hasContent = message && message.trim().length > 0

  const onFormSubmit = (data: ChatMessageFormValues) => {
    onSubmit(data)
    reset({ message: "" })
    textareaRef.current?.updateTextareaHeight()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (hasContent) {
        handleSubmit(onFormSubmit)()
      }
    }
  }

  const handleContainerClick = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const { onChange, onBlur, name, ref: registerRef } = register("message")

  const mergedRef = useCallback(
    (node: AutoExpandingTextareaRef | null) => {
      registerRef(node)
      if (node) {
        textareaRef.current = node
      }
    },
    [registerRef],
  )

  return (
      <form onSubmit={handleSubmit(onFormSubmit)} className={cn("flex items-end justify-center pb-6 px-4", className)} style={{ background: "linear-gradient(to bottom, transparent 0px, var(--color-card) 2rem)" }}>
        <div className="w-full max-w-4xl">
          <div
            onClick={handleContainerClick}
            className={cn(
              "relative flex items-end gap-2 rounded-5 border border-neutral-700 p-5 shadow-lg shadow-black/15 bg-neutral-800",
              errors.message && "border-red-400 ring-red-500/20 dark:ring-red-500/40",
            )}
          >
          <div className="flex-1 min-w-0">
            <AutoExpandingTextarea
              name={name}
              ref={mergedRef}
              value={message || ""}
              onChange={(e) => {
                onChange(e)
              }}
              onBlur={onBlur}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="w-full bg-transparent leading-5 outline-none placeholder:text-muted-foreground"
              maxHeight={144}
              minHeight={24}
            />
          </div>

          <Button
            type="submit"
            disabled={!hasContent}
            className="shrink-0"
            size="icon"
          >
            <Send className="size-4" />
          </Button>
          </div>

          {errors.message && (
            <p className="text-xs text-red-400 mt-1 px-4">{errors.message.message}</p>
          )}

        </div>
      </form>
  )
}
