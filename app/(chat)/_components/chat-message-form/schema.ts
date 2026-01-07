import { z } from "zod"

export const chatMessageFormSchema = z.object({
  message: z.string().max(3000, "Message cannot be longer than 3000 characters"),
})

export type ChatMessageFormValues = z.infer<typeof chatMessageFormSchema>

