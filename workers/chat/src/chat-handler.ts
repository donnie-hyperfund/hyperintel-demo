import { SendConversationActionDto } from "@/lib/schema/chat";
import { Ctx } from "./context";

export async function chatActionHandler(data: SendConversationActionDto, ctx: Ctx) {
    const { messages, conversationId } = data;

    // Simulate AI response with slight delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    const lastMessage = messages[messages.length - 1]?.content || '';

    // Generate different responses for left and right panels
    const responses = {
        left: `This is the response from Model A. You said: "${lastMessage}". I'm processing this with approach A, which focuses on detailed analysis and comprehensive answers.`,
        right: `This is the response from Model B. You said: "${lastMessage}". I'm processing this with approach B, which emphasizes concise and direct responses.`,
    };

    return {
        message: responses[conversationId as 'left' | 'right'] || responses.left,
    };
}
