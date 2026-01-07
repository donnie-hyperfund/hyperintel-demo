"use client"

import * as React from "react"
import { TextareaHTMLAttributes, useImperativeHandle, useRef, useCallback, useEffect, useLayoutEffect } from "react"
import { cn } from "@/lib/utils"

export type AutoExpandingTextareaRef = {
  updateTextareaHeight: () => void
} & HTMLTextAreaElement

type AutoExpandingTextareaProps = {
  maxHeight?: number
  minHeight?: number
} & TextareaHTMLAttributes<HTMLTextAreaElement>

const AutoExpandingTextarea = React.forwardRef<AutoExpandingTextareaRef, AutoExpandingTextareaProps>(
  ({ className, maxHeight = 144, minHeight = 20, onInput, value, ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const updateTextareaHeight = useCallback(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.style.height = "0px"
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    }, [maxHeight])

    useImperativeHandle(ref, () => {
      const textarea = textareaRef.current
      if (!textarea) return null as unknown as AutoExpandingTextareaRef
      return Object.assign(textarea, {
        updateTextareaHeight,
      })
    }, [updateTextareaHeight])

    const handleInput = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateTextareaHeight()
        onInput?.(e)
      },
      [updateTextareaHeight, onInput],
    )

    // Reset height when the component receives a new empty value
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea && value === "") {
        textarea.style.height = `${minHeight}px`
      }
    }, [value, minHeight])

    useLayoutEffect(() => {
      updateTextareaHeight()
    }, [updateTextareaHeight])

    return (
      <textarea
        ref={textareaRef}
        className={cn("resize-none overflow-y-auto", className)}
        style={{ minHeight: `${minHeight}px` }}
        onInput={handleInput}
        value={value}
        {...props}
      />
    )
  },
)

AutoExpandingTextarea.displayName = "AutoExpandingTextarea"

export { AutoExpandingTextarea }

