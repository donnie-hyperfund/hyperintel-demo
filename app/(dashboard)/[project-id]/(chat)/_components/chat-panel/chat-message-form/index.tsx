'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { AutoExpandingTextarea, type AutoExpandingTextareaRef } from '@/components/ui/auto-expanding-textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { NextStagePill } from './next-stage-pill';
import { type ChatMessageFormValues, chatMessageFormSchema } from './schema';

type ChatMessageFormProps = {
    className?: string;
};

const ChatMessageForm = forwardRef<HTMLDivElement, ChatMessageFormProps>(({ className }, ref) => {
    const {
        sendMessage,
        state: { isGenerating, isSummarizing, isLoading },
    } = useChatContext();

    const textareaRef = useRef<AutoExpandingTextareaRef>(null);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        formState: { errors },
    } = useForm<ChatMessageFormValues>({
        resolver: zodResolver(chatMessageFormSchema),
        defaultValues: {
            message: '',
        },
    });

    const message = watch('message');
    const hasContent = message && message.trim().length > 0;
    const isDisabled = !hasContent || isGenerating || isSummarizing || isLoading;

    const onFormSubmit = async (data: ChatMessageFormValues) => {
        if (!data.message.trim()) return;
        reset({ message: '' });
        textareaRef.current?.updateTextareaHeight();
        await sendMessage(data.message);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isDisabled) {
                handleSubmit(onFormSubmit)();
            }
        }
    };

    const handleContainerClick = useCallback(() => {
        textareaRef.current?.focus();
    }, []);

    const { onChange, onBlur, name, ref: registerRef } = register('message');

    const mergedRef = useCallback(
        (node: AutoExpandingTextareaRef | null) => {
            registerRef(node);
            if (node) {
                textareaRef.current = node;
            }
        },
        [registerRef],
    );

    return (
        <div ref={ref} className={className}>
            <NextStagePill />

            <AnimatePresence>
                <form
                    onSubmit={handleSubmit(onFormSubmit)}
                    className="relative flex items-end justify-center pb-6 px-4"
                >
                    {/* Background component*/}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            background: 'linear-gradient(to bottom, transparent 0px, var(--color-card) 2rem)',
                        }}
                    />

                    <div className="w-full max-w-4xl relative z-10">
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                            onClick={handleContainerClick}
                            className={cn(
                                'relative flex items-end gap-2 rounded-5 border border-neutral-700 p-5 shadow-lg shadow-black/15 bg-neutral-800',
                                errors.message && 'border-red-400 ring-red-500/20 dark:ring-red-500/40',
                            )}
                        >
                            <div className="flex-1 min-w-0">
                                <AutoExpandingTextarea
                                    name={name}
                                    ref={mergedRef}
                                    value={message || ''}
                                    onChange={(e) => {
                                        onChange(e);
                                    }}
                                    onBlur={onBlur}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Type your message..."
                                    className="w-full bg-transparent leading-5 outline-none placeholder:text-muted-foreground"
                                    maxHeight={144}
                                    minHeight={24}
                                />
                            </div>

                            <Button type="submit" disabled={isDisabled} className="shrink-0" size="icon">
                                <Send className="size-4" />
                            </Button>
                        </motion.div>

                        {errors.message && (
                            <motion.p
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="text-xs text-red-400 mt-1 px-4"
                            >
                                {errors.message.message}
                            </motion.p>
                        )}
                    </div>
                </form>
            </AnimatePresence>
        </div>
    );
});

ChatMessageForm.displayName = 'ChatMessageForm';

export default ChatMessageForm;
