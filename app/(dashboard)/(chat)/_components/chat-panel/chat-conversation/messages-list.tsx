import { cva } from 'class-variance-authority';
import { AnimatePresence, motion } from 'motion/react';
import type { Message } from '@/modules/chat/types';
import ChatMessage from '../chat-message';

type MessagesProps = {
    messages: Message[];
};

const messageContainerVariants = cva('w-full min-w-0 last:mb-0', {
    variants: {
        role: {
            user: 'mb-6',
            assistant: 'mb-14',
        },
    },
});

export default function MessagesList({ messages }: MessagesProps) {
    return (
        <AnimatePresence initial={false}>
            {messages.map((message, index) => (
                <motion.div
                    key={message.id ?? index}
                    initial={{
                        opacity: 0,
                        y: 8,
                        scale: 0.98,
                    }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{
                        opacity: 0,
                        y: -6,
                        scale: 0.98,
                    }}
                    transition={{
                        duration: 0.3,
                        ease: 'easeInOut',
                    }}
                    className={messageContainerVariants({ role: message.role })}
                >
                    <ChatMessage message={message} />
                </motion.div>
            ))}
        </AnimatePresence>
    );
}
