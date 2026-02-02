'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function NextStagePill() {
    const { hasArtifacts, summarizeChat, state } = useChatContext();

    const shouldRender = hasArtifacts && !state.isGenerating && !state.isLoading;

    return (
        <AnimatePresence>
            {shouldRender && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="flex justify-center mb-5"
                >
                    <Button
                        onClick={summarizeChat}
                        disabled={state.isSummarizing}
                        className="rounded-full px-6 py-2 shadow-xl gap-2"
                        size="lg"
                    >
                        {state.isSummarizing ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Summarizing...
                            </>
                        ) : (
                            <>
                                Go to next stage
                                <ArrowRight className="h-4 w-4" />
                            </>
                        )}
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
