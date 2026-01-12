<<<<<<< HEAD:app/api/chat/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { UserEntity } from '@/lib/orm';

async function handleChat(req: NextRequest, user: UserEntity) {
    const { messages, conversationId } = await req.json();
=======
import { SendConversationActionDto } from "@/lib/schema/chat";
import { Ctx } from "./context";

export async function chatActionHandler(data: SendConversationActionDto, ctx: Ctx) {
    const { messages, conversationId } = data;
>>>>>>> jrazny/initial-entities:workers/chat/src/chat-handler.ts

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
<<<<<<< HEAD:app/api/chat/route.ts
    });
}

export const POST = withAuth(async (req, user) => {
    try {
        return await handleChat(req, user);
    } catch (error) {
        console.error('Error in chat API:', error);
        return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
    }
});
=======
    };
}
>>>>>>> jrazny/initial-entities:workers/chat/src/chat-handler.ts
