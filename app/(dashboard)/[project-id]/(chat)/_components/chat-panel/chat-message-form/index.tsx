'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Send } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { AutoExpandingTextarea, type AutoExpandingTextareaRef } from '@/components/ui/auto-expanding-textarea';
import { Button } from '@/components/ui/button';
import { IS_DEV } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';
import { ContextUsageIndicator } from '../context-usage-indicator';
import { AttachFileButton } from './attach-file-button';
import { FilePreviewItem } from './file-preview-item';
import { type ChatMessageFormValues, chatMessageFormSchema } from './schema';
import { SwitchModelSelector } from './switch-model-selector';

type ChatMessageFormProps = {
    className?: string;
    ref?: React.RefObject<HTMLDivElement | null>;
};

const ChatMessageForm = ({ className, ref }: ChatMessageFormProps) => {
    const {
        sendMessage,
        chatId,
        state: { isGenerating, isSummarizing, isLoading, tokenUsage },
    } = useChatContext();

    const { files, removeFile, submitFiles, isSubmitting } = useFileUploadContext();

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
    const isBusy = isGenerating || isSummarizing || isLoading || isSubmitting;
    const isDisabled = !hasContent || isBusy;

    const onFormSubmit = async (data: ChatMessageFormValues) => {
        if (!data.message.trim() && files.length === 0) return;

        // Capture file names before submitFiles clears them
        const uploadedFiles = files.map((entry) => entry.file);

        if (uploadedFiles.length > 0) {
            await submitFiles({ chatId: chatId ?? undefined });
        }

        const fileDirective =
            uploadedFiles.length > 0 ? uploadedFiles.map((f) => `::upload[${f.name}]{size=${f.size}}`).join('\n') : '';

        const message = [fileDirective, data.message.trim()].filter(Boolean).join('\n\n');

        reset({ message: '' });
        textareaRef.current?.updateTextareaHeight();

        if (message) {
            await sendMessage(message);
        }
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
            <AnimatePresence>
                <form onSubmit={handleSubmit(onFormSubmit)} className="relative flex items-end justify-center px-4">
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

                    <div className="w-full max-w-3xl relative z-10">
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                            onClick={handleContainerClick}
                            className={cn(
                                'relative flex flex-wrap items-end gap-3 rounded-5 border border-neutral-700 p-5 shadow-lg shadow-black/15 bg-neutral-800',
                                errors.message && 'border-red-400 ring-red-500/20 dark:ring-red-500/40',
                            )}
                        >
                            {files.length > 0 && (
                                <div className="relative w-full max-h-48 overflow-y-clip mb-1">
                                    <div className="grid grid-cols-2 w-full relative flex-wrap gap-3 max-h-48 overflow-y-auto pb-2">
                                        {files.map((entry, i) => (
                                            <FilePreviewItem
                                                key={`${entry.file.name}-${entry.file.size}`}
                                                file={entry.file}
                                                status={entry.status}
                                                onRemove={() => removeFile(i)}
                                            />
                                        ))}
                                    </div>

                                    <div
                                        className="absolute top-46 left-0 right-0 h-2"
                                        style={{
                                            background:
                                                'linear-gradient(to bottom, transparent 0px, var(--color-neutral-800))',
                                        }}
                                    />
                                </div>
                            )}

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
                                className="w-full bg-transparent leading-6 outline-none placeholder:text-muted-foreground"
                                maxHeight={364}
                                minHeight={24}
                            />

                            {chatId && <AttachFileButton />}

                            <div className="flex items-end gap-2 ml-auto">
                                {IS_DEV && <SwitchModelSelector disabled={isBusy} />}
                                <Button type="submit" disabled={isDisabled} className="shrink-0" size="icon">
                                    <Send className="size-4" />
                                </Button>
                            </div>
                        </motion.div>

                        <div className="flex items-center h-9 px-1 justify-between">
                            {errors.message && (
                                <motion.p
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="text-xs text-red-400 justify-self-start"
                                >
                                    {errors.message.message}
                                </motion.p>
                            )}

                            <ContextUsageIndicator tokenUsage={tokenUsage} className="justify-self-right ml-auto" />
                        </div>
                    </div>
                </form>
            </AnimatePresence>
        </div>
    );
};

export default ChatMessageForm;
