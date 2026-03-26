'use client';

import { motion } from 'motion/react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type OnboardingStepContextValue = {
    footerHeight: number;
    setFooterHeight: (height: number) => void;
};

const OnboardingStepContext = createContext<OnboardingStepContextValue>({
    footerHeight: 0,
    setFooterHeight: () => {},
});

type OnboardingStepRootProps = {
    children: ReactNode;
    className?: string;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
};

const maxWidthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
} as const;

function Root({ children, className, maxWidth = 'md' }: OnboardingStepRootProps) {
    const [footerHeight, setFooterHeight] = useState(0);

    return (
        <OnboardingStepContext.Provider value={{ footerHeight, setFooterHeight }}>
            <div
                className={cn('mx-auto w-full', maxWidthMap[maxWidth], className)}
                style={{ paddingBottom: footerHeight > 0 ? footerHeight : undefined }}
            >
                {children}
            </div>
        </OnboardingStepContext.Provider>
    );
}

type OnboardingStepHeaderProps = {
    title: string;
    description?: string;
};

function Header({ title, description }: OnboardingStepHeaderProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="mb-8 space-y-2 text-center"
        >
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>}
        </motion.div>
    );
}

type OnboardingStepCardProps = {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    showPadding?: boolean;
};

function StepCard({ children, className, contentClassName, showPadding = true }: OnboardingStepCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
        >
            <Card
                className={cn(
                    'border-neutral-900 bg-neutral-900/50 shadow-xl backdrop-blur mb-10 py-0',
                    showPadding ? 'py-5 md:py-7' : 'py-0',
                    className,
                )}
            >
                <CardContent className={cn(showPadding ? 'px-4 md:px-7' : 'px-0', contentClassName)}>
                    {children}
                </CardContent>
            </Card>
        </motion.div>
    );
}

type OnboardingStepFooterProps = {
    children: ReactNode;
    className?: string;
};

function Footer({ children, className }: OnboardingStepFooterProps) {
    const { setFooterHeight } = useContext(OnboardingStepContext);
    const observerRef = useRef<ResizeObserver | null>(null);

    const footerRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }

            if (node) {
                setFooterHeight(node.offsetHeight);
                observerRef.current = new ResizeObserver(([entry]) => {
                    setFooterHeight(entry.borderBoxSize[0].blockSize);
                });
                observerRef.current.observe(node);
            } else {
                setFooterHeight(0);
            }
        },
        [setFooterHeight],
    );

    return (
        <motion.div
            ref={footerRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
            className={cn(
                'fixed bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-neutral-950 flex flex-col items-center gap-4',
                'md:static md:p-0 md:bg-transparent md:gap-7 md:w-full',
                className,
            )}
        >
            {children}
        </motion.div>
    );
}

export const OnboardingStep = {
    Root,
    Header,
    Card: StepCard,
    Footer,
};
