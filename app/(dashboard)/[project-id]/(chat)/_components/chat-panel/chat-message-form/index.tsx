'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUp, Loader2, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AutoExpandingTextarea, type AutoExpandingTextareaRef } from '@/components/ui/auto-expanding-textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { ApiClientError } from '@/lib/api/client/types';
import { IS_DEV } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useChatDraft } from '@/modules/chat/hooks/use-chat-draft';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useModelSelection } from '@/modules/chat/providers/model-selection-provider';
import { getContextBypassForChat, setContextBypassForChat } from '@/modules/chat/utils/context-bypass-session';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';
import { ContextHardStopModal } from '../../context-hard-stop-modal';
import { ContextWarningModal } from '../../context-warning-modal';
import { AttachFileButton } from './attach-file-button';
import { FilePreviewItem } from './file-preview-item/file-preview-item';
import { ImageUploadModeSelector } from './image-upload-mode-selector';
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
        dismissContextLimitAlert,
        dismissContextWarningModal,
        sendForceBrief,
        dismissHardStopModal,
        navigateToExistingNextChat,
        requestPhaseTransition,
        state: {
            isGenerating,
            isSummarizing,
            isLoading,
            isProcessingArtifactAction,
            activeResponseId,
            showInvalidModelAlert,
            showContextLimitAlert,
            showContextWarningModal,
            hardStopModalState,
            hardStopExistingNextChatId,
            hardStopError,
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
        consumeDraftArtifactIds,
    } = useFileUploadContext();
    const { initialDraft, saveDraft, clearDraft } = useChatDraft(chatType, chatId, projectId);
    const textareaRef = useRef<AutoExpandingTextareaRef>(null);
    const bypassContextWarningRef = useRef(false);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        setValue,
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
    const isSending = isGenerating || isSubmitting;

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
        const draftArtifactIds = [...new Set(files.flatMap((entry) => (entry.artifactId ? [entry.artifactId] : [])))];
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
                draftArtifactIds?: string[];
                imageFileIds?: string[];
                onUploadsAssociated?: () => Promise<void>;
                isDeferredSend?: boolean;
                bypassContextWarning?: boolean;
            } = {};

            const shouldBypass = bypassContextWarningRef.current || (chatId ? getContextBypassForChat(chatId) : false);
            bypassContextWarningRef.current = false;
            if (shouldBypass) opts.bypassContextWarning = true;
            if (hasStagedUploads && stagedArtifactIds.length > 0) opts.stagedArtifactIds = stagedArtifactIds;
            if (draftArtifactIds.length > 0) opts.draftArtifactIds = draftArtifactIds;
            if (imageFileIds.length > 0) opts.imageFileIds = imageFileIds;
            if (hasStagedUploads && stagedArtifactIds.length > 0) {
                opts.onUploadsAssociated = () => waitForArtifactsReady(stagedArtifactIds);
                opts.isDeferredSend = true;
            }

            consumeStagedArtifactIds();
            consumeStagedImageFileIds();
            consumeDraftArtifactIds();

            // Don't clear input or files until the POST resolves successfully. This keeps both
            // halves of the draft in sync with the transcript (visible during the POST round-trip,
            // cleared together once the server accepts the message) AND gives us the disaster-mode
            // guarantee for free: on failure nothing was cleared, so there's nothing to restore.
            // Deferred path: input clear is handled by the activeResponseId effect above (the form
            // instance may remount mid-flight); submitFiles below clears the chips.
            try {
                await sendMessage(message, Object.keys(opts).length > 0 ? opts : undefined);
            } catch (error) {
                if (error instanceof ApiClientError && error.code === 'CONTEXT_TOO_LONG') {
                    return;
                }
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
                return;
            }

            // Rich content paste (e.g. from Notion) — extract clean text from HTML
            // to avoid markdown image references like ![...](attachment:...) breaking the message
            const html = e.clipboardData.getData('text/html');
            if (html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const cleanText = doc.body.textContent || '';

                if (cleanText) {
                    e.preventDefault();
                    const textarea = textareaRef.current;
                    if (textarea) {
                        const start = textarea.selectionStart ?? 0;
                        const end = textarea.selectionEnd ?? 0;
                        const current = message || '';
                        const newValue = current.slice(0, start) + cleanText + current.slice(end);
                        setValue('message', newValue);
                        saveDraft(newValue);
                        // Set cursor position after inserted text
                        requestAnimationFrame(() => {
                            textarea.selectionStart = start + cleanText.length;
                            textarea.selectionEnd = start + cleanText.length;
                            textareaRef.current?.updateTextareaHeight();
                        });
                    }
                }
            }
        },
        [addFiles, isAwaitingStream, message, setValue, saveDraft],
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

    const handleContextLimitProceed = useCallback(() => {
        dismissContextLimitAlert();
        requestPhaseTransition();
    }, [dismissContextLimitAlert, requestPhaseTransition]);

    const handleWarningContinue = useCallback(
        (dontRemindAgain: boolean) => {
            if (dontRemindAgain && chatId) setContextBypassForChat(chatId);
            dismissContextWarningModal();
            bypassContextWarningRef.current = true;
            handleSubmit(onFormSubmit)();
        },
        [chatId, dismissContextWarningModal, handleSubmit, onFormSubmit],
    );

    const handleWarningNextPhase = useCallback(() => {
        dismissContextWarningModal();
        requestPhaseTransition();
    }, [dismissContextWarningModal, requestPhaseTransition]);

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
                                                disabled={isSending}
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
                                className="w-full bg-transparent leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                maxHeight={384}
                                minHeight={24}
                                disabled={isAwaitingStream}
                            />

                            {(chatId || chatType !== 'phase') && <AttachFileButton disabled={isAwaitingStream} />}

                            <ImageUploadModeSelector disabled={isBusy} />

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

                        {errors.message && (
                            <motion.p
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="px-1 pt-1 text-xs text-red-400"
                            >
                                {errors.message.message}
                            </motion.p>
                        )}
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

            <ContextWarningModal
                open={showContextWarningModal}
                onContinue={handleWarningContinue}
                onNextPhase={handleWarningNextPhase}
                onCancel={dismissContextWarningModal}
            />

            <ContextHardStopModal
                open={hardStopModalState !== 'closed'}
                state={hardStopModalState === 'closed' ? 'idle' : hardStopModalState}
                onConfirm={sendForceBrief}
                onCancel={dismissHardStopModal}
                onNavigate={navigateToExistingNextChat}
                existingNextChatId={hardStopExistingNextChatId ?? undefined}
                error={hardStopError}
            />

            <AlertDialog open={showContextLimitAlert} onOpenChange={(isOpen) => !isOpen && dismissContextLimitAlert()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Context limit reached</AlertDialogTitle>
                        <AlertDialogDescription>
                            {chatType === 'phase'
                                ? 'You have reached the context limit for this phase. Would you like to create a Completion Brief and move to the next phase?'
                                : 'This conversation has reached the context limit. Start a new conversation before continuing.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {chatType === 'phase' ? (
                            <>
                                <AlertDialogCancel onClick={dismissContextLimitAlert}>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleContextLimitProceed}>Continue</AlertDialogAction>
                            </>
                        ) : (
                            <AlertDialogAction onClick={dismissContextLimitAlert}>OK</AlertDialogAction>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ChatMessageForm;
