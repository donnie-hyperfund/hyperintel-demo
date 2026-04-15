'use client';

import { AnimatePresence, motion } from 'motion/react';

export function AnimatedHeadline({ text }: { text: string }) {
    const words = text.split(' ');

    return (
        <AnimatePresence mode="wait">
            <motion.h1
                key={text}
                className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground text-center max-w-lg leading-tight"
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={{
                    hidden: {},
                    visible: { transition: { staggerChildren: 0.04 } },
                    exit: { opacity: 0, y: -12, transition: { duration: 0.15 } },
                }}
            >
                {words.map((word, i) => (
                    <motion.span
                        key={`${text}-${i}`}
                        className="inline-block mr-[0.3em]"
                        variants={{
                            hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
                            visible: {
                                opacity: 1,
                                y: 0,
                                filter: 'blur(0px)',
                                transition: { duration: 0.35, ease: 'easeOut' },
                            },
                        }}
                    >
                        {word}
                    </motion.span>
                ))}
            </motion.h1>
        </AnimatePresence>
    );
}
