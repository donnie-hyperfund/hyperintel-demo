'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AutoExpandingTextarea, type AutoExpandingTextareaRef } from '@/components/ui/auto-expanding-textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { IS_DEV } from '@/lib/config';
import { DevSlot } from '@/lib/dev-slots';
import { cn } from '@/lib/utils';
import { useChatDraft } from '@/modules/chat/hooks/use-chat-draft';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';
import { ContextUsageIndicator } from '../context-usage-indicator';
import { AttachFileButton } from './attach-file-button';
import { FilePreviewItem } from './file-preview-item/file-preview-item';
import { type ChatMessageFormValues, chatMessageFormSchema } from './schema';
import { SwitchModelSelector } from './switch-model-selector';

type ChatMessageFormProps = {
    className?: string;
    showGradientFade?: boolean;
};

const ChatMessageForm = ({ className, showGradientFade = true }: ChatMessageFormProps) => {
    const {
        sendMessage,
        chatType,
        chatId,
        projectId,
        stopGeneration,
        dismissInvalidModelAlert,
        state: {
            isGenerating,
            isSummarizing,
            isLoading,
            isProcessingArtifactAction,
            tokenUsage,
            activeResponseId,
            showInvalidModelAlert,
        },
    } = useChatContext();
    const { selectedModel } = useModelSelection();

    const {
        files,
        addFiles,
        removeFile,
        submitFiles,
        waitForArtifactsReady,
        isSubmitting,
        consumeStagedArtifactIds,
        consumeStagedImageFileIds,
    } = useFileUploadContext();
    const { initialDraft, saveDraft, clearDraft } = useChatDraft(chatType, chatId, projectId);
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
            message: initialDraft,
        },
    });

    const message = watch('message');

    // Clear draft + input when the send actually starts streaming. This is the shared
    // cleanup for the deferred path (whose remounted form instance hydrates with the
    // migrated draft) and a redundant safety-net for the normal path (already cleared).
    const prevActiveResponseIdRef = useRef(activeResponseId);
    useEffect(() => {
        if (!prevActiveResponseIdRef.current && activeResponseId) {
            clearDraft();
            reset({ message: '' });
            textareaRef.current?.updateTextareaHeight();
        }
        prevActiveResponseIdRef.current = activeResponseId;
    }, [activeResponseId, clearDraft, reset]);
    const hasContent = message && message.trim().length > 0;
    const hasDeferredFilesAwaitingAssociation = !chatId && files.some((f) => f.requiresAssociation);
    const hasBlockingFiles = files.some(
        (f) =>
            (f.status === 'uploading' || f.status === 'processing') &&
            !(f.status === 'processing' && !chatId && f.requiresAssociation),
    );
    const isBusy =
        isGenerating || isSummarizing || isLoading || isSubmitting || hasBlockingFiles || isProcessingArtifactAction;
    const isAwaitingStream = isGenerating && !activeResponseId;
    const isSubmitDisabled = !hasContent || isBusy;

    const onFormSubmit = async (data: ChatMessageFormValues) => {
        if (!data.message.trim() && files.length === 0) return;

        // Capture file names before submitFiles clears them
        const uploadedFiles = files.map((entry) => ({
            name: entry.name,
            size: entry.size,
            imageFileId: entry.imageFileId,
            imageWidth: entry.imageWidth,
            imageHeight: entry.imageHeight,
        }));

        const stagedArtifactIds = [
            ...new Set(
                files.flatMap((entry) => (entry.requiresAssociation && entry.artifactId ? [entry.artifactId] : [])),
            ),
        ];
        const imageFileIds = [...new Set(files.flatMap((entry) => (entry.imageFileId ? [entry.imageFileId] : [])))];

        const hasStagedUploads =
            hasDeferredFilesAwaitingAssociation && (stagedArtifactIds.length > 0 || imageFileIds.length > 0);

        const fileDirective =
            uploadedFiles.length > 0
                ? uploadedFiles
                      .map((f) => {
                          const attrs = [`size=${f.size}`];
                          if (f.imageFileId) {
                              attrs.push(`fileid=${f.imageFileId}`, 'type=image');
                              if (f.imageWidth && f.imageHeight) attrs.push(`w=${f.imageWidth}`, `h=${f.imageHeight}`);
                          }
                          return `::upload[${f.name}]{${attrs.join(' ')}}`;
                      })
                      .join('\n')
                : '';

        const message = [fileDirective, data.message.trim()].filter(Boolean).join('\n\n');

        if (message) {
            const opts: {
                stagedArtifactIds?: string[];
                imageFileIds?: string[];
                onUploadsAssociated?: () => Promise<void>;
                isDeferredSend?: boolean;
            } = {};
            if (hasStagedUploads && stagedArtifactIds.length > 0) opts.stagedArtifactIds = stagedArtifactIds;
            if (imageFileIds.length > 0) opts.imageFileIds = imageFileIds;
            if (hasStagedUploads && stagedArtifactIds.length > 0) {
                opts.onUploadsAssociated = () => waitForArtifactsReady(stagedArtifactIds);
                opts.isDeferredSend = true;
            }

            consumeStagedArtifactIds();
            consumeStagedImageFileIds();

            // Don't clear input or files until the POST resolves successfully. This keeps both
            // halves of the draft in sync with the transcript (visible during the POST round-trip,
            // cleared together once the server accepts the message) AND gives us the disaster-mode
            // guarantee for free: on failure nothing was cleared, so there's nothing to restore.
            // Deferred path: input clear is handled by the activeResponseId effect above (the form
            // instance may remount mid-flight); submitFiles below clears the chips.
            try {
                await sendMessage(message, Object.keys(opts).length > 0 ? opts : undefined);
            } catch (error) {
                toast({
                    title: 'Failed to send message',
                    description: error instanceof Error ? error.message : 'Please try again.',
                    variant: 'destructive',
                });
                return;
            }

            if (!opts.isDeferredSend) {
                clearDraft();
                reset({ message: '' });
                textareaRef.current?.updateTextareaHeight();
            }

            if (uploadedFiles.length > 0) {
                await submitFiles();
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isSubmitDisabled) {
                handleSubmit(onFormSubmit)();
            }
        }
    };

    const handlePaste = useCallback(
        (e: React.ClipboardEvent) => {
            if (isAwaitingStream) return;

            const imageFiles = Array.from(e.clipboardData.items)
                .filter((item) => item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null);

            if (imageFiles.length > 0) {
                // Give pasted screenshots a sensible name
                const named = imageFiles.map((f, i) => {
                    const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
                    const name = `screenshot-${Date.now()}${imageFiles.length > 1 ? `-${i + 1}` : ''}.${ext}`;
                    return new File([f], name, { type: f.type });
                });
                addFiles(named, { source: 'paste' });
            }
        },
        [addFiles, isAwaitingStream],
    );

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
        <div className={className}>
            <AnimatePresence>
                <form onSubmit={handleSubmit(onFormSubmit)} className="relative flex items-end justify-center px-4">
                    {showGradientFade && (
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
                    )}

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
                                    <div className="grid md:grid-cols-2 w-full relative flex-wrap gap-3 max-h-48 overflow-y-auto pb-2">
                                        {files.map((entry, i) => (
                                            <FilePreviewItem
                                                key={entry.id}
                                                name={entry.name}
                                                size={entry.size}
                                                status={entry.status}
                                                file={entry.file}
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
                                    saveDraft(e.target.value);
                                }}
                                onBlur={onBlur}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                                placeholder="Type your message..."
                                className="w-full bg-transparent leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                                maxHeight={384}
                                minHeight={24}
                                disabled={isAwaitingStream}
                            />

                            {(chatId || chatType !== 'phase') && <AttachFileButton disabled={isAwaitingStream} />}

                            <div className="flex items-end gap-2 ml-auto">
                                {IS_DEV && <SwitchModelSelector disabled={isBusy} />}

                                {isGenerating ? (
                                    activeResponseId ? (
                                        <Button
                                            type="button"
                                            onClick={stopGeneration}
                                            variant="unstyled"
                                            className="size-9 bg-transparent hover:bg-accent text-white border border-neutral-500/35"
                                        >
                                            <Square className="size-3.5 fill-current" />
                                        </Button>
                                    ) : (
                                        <Button type="button" disabled className="size-9 shrink-0" variant="secondary">
                                            <Loader2 className="size-4 animate-spin" />
                                        </Button>
                                    )
                                ) : (
                                    <Button type="submit" disabled={isSubmitDisabled} className="size-9 shrink-0">
                                        <ArrowUp className="size-5" />
                                    </Button>
                                )}
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

                            <DevSlot name="chat-footer" />
                            <ContextUsageIndicator tokenUsage={tokenUsage} className="justify-self-right ml-auto" />
                        </div>
                    </div>
                </form>
            </AnimatePresence>

            <AlertDialog open={showInvalidModelAlert} onOpenChange={(isOpen) => !isOpen && dismissInvalidModelAlert()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Model unavailable</AlertDialogTitle>
                        <AlertDialogDescription>
                            The selected model &quot;{selectedModel}&quot; is no longer available. Please select a
                            different model before sending a message.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={dismissInvalidModelAlert}>OK</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ChatMessageForm;
