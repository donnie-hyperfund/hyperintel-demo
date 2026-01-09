import { AnimatePresence, motion } from 'motion/react';
import { Message } from '@/app/(dashboard)/(chat)/_components/chat-panel/chat-conversation/chat-conversation';
import ChatMessage from '../chat-message';

type MessagesProps = {
    messages: Message[];
};

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
                    className="w-full min-w-0"
                >
                    <ChatMessage message={message} />
                </motion.div>
            ))}
        </AnimatePresence>
    );
}
