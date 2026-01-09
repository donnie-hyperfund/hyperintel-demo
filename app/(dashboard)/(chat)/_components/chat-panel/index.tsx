'use client';

import { useEffect, useRef, useState } from 'react';
import { MOCK_MESSAGES } from '@/app/(dashboard)/(chat)/_components/chat-panel/mock';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import ChatConversation, { type Message } from './chat-conversation/chat-conversation';
import ChatMessageForm from './chat-message-form';
import type { ChatMessageFormValues } from './chat-message-form/schema';

type Conversation = {
    id: string;
    messages: Message[];
    isLoading: boolean;
};

export default function ChatPanel() {
    const chatConversationRef = useRef<HTMLDivElement>(null);
    const chatMessageFormRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        const formElement = chatMessageFormRef.current;
        const conversationElement = chatConversationRef.current;

        if (!formElement || !conversationElement) return;

        const updatePadding = () => {
            const height = formElement.offsetHeight;
            console.log(height);
            conversationElement.style.paddingBottom = `${height + 16}px`;
        };

        updatePadding();

        const resizeObserver = new ResizeObserver(updatePadding);
        resizeObserver.observe(formElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const [conversations, setConversations] = useState<Conversation[]>([
        {
            id: 'left',
            messages: MOCK_MESSAGES,
            isLoading: false,
        },
        {
            id: 'right',
            messages: [
                {
                    role: 'assistant',
                    content:
                        "```tsx\n// components/ui/button.tsx\nimport { cn } from '@/lib/utils'\n\ninterface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'primary' | 'secondary' | 'outline'\n  size?: 'sm' | 'md' | 'lg'\n}\n\nexport const Button = ({ \n  variant = 'primary', \n  size = 'md',\n  className,\n  children,\n  ...props \n}: ButtonProps) => {\n  return (\n    <button\n      className={cn(\n        'rounded-lg font-medium transition-colors',\n        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',\n        variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',\n        variant === 'outline' && 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',\n        size === 'sm' && 'px-3 py-1.5 text-sm',\n        size === 'md' && 'px-4 py-2',\n        size === 'lg' && 'px-6 py-3 text-lg',\n        className\n      )}\n      {...props}\n    >\n      {children}\n    </button>\n  )\n}\n```",
                    id: '1',
                },
            ],
            isLoading: false,
        },
    ]);

    const handleSend = async (data: ChatMessageFormValues) => {
        if (!data.message.trim()) return;

        const userMessage: Message = {
            role: 'user',
            content: data.message,
            id: '13',
        };

        // Add user message to both conversations
        setConversations((prev) =>
            prev.map((conv) => ({
                ...conv,
                messages: [...conv.messages, userMessage],
                isLoading: true,
            })),
        );

        // Simulate AI responses for both panels
        try {
            const responses = await Promise.all([
                fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [...conversations[0].messages, userMessage],
                        conversationId: 'left',
                    }),
                }),
                fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [...conversations[1].messages, userMessage],
                        conversationId: 'right',
                    }),
                }),
            ]);

            const [leftData, rightData] = await Promise.all([responses[0].json(), responses[1].json()]);

            setConversations((prev) => [
                {
                    ...prev[0],
                    messages: [
                        ...prev[0].messages,
                        { role: 'assistant', content: leftData.message, id: `${Date.now()}-left` },
                    ],
                    isLoading: false,
                },
                {
                    ...prev[1],
                    messages: [
                        ...prev[1].messages,
                        { role: 'assistant', content: rightData.message, id: `${Date.now()}-right` },
                    ],
                    isLoading: false,
                },
            ]);
        } catch (error) {
            console.error('Error fetching responses:', error);
            setConversations((prev) =>
                prev.map((conv) => ({
                    ...conv,
                    isLoading: false,
                })),
            );
        }
    };

    return (
        <div className="flex flex-col relative h-full">
            <DashboardHeader />

            <ChatConversation
                messages={conversations[0].messages}
                isLoading={conversations[0].isLoading}
                ref={chatConversationRef}
            />

            <ChatMessageForm
                ref={chatMessageFormRef}
                onSubmit={handleSend}
                className="absolute bottom-0 left-0 right-0"
            />
        </div>
    );
}
