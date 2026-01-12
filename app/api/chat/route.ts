import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { UserEntity } from '@/lib/orm';

async function handleChat(req: NextRequest, user: UserEntity) {
    const { messages, conversationId } = await req.json();

    // Simulate AI response with slight delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    const lastMessage = messages[messages.length - 1]?.content || '';

    // Generate different responses for left and right panels
    const responses = {
        left: `This is the response from Model A. You said: "${lastMessage}". I'm processing this with approach A, which focuses on detailed analysis and comprehensive answers.`,
        right: `This is the response from Model B. You said: "${lastMessage}". I'm processing this with approach B, which emphasizes concise and direct responses.`,
    };

    return NextResponse.json({
        message: responses[conversationId as 'left' | 'right'] || responses.left,
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
