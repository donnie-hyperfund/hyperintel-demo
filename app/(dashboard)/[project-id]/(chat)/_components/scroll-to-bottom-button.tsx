'use client';

import { ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';

type ScrollToBottomButtonProps = {
    onClick: () => void;
    className?: string;
};

export function ScrollToBottomButton({ onClick, className }: ScrollToBottomButtonProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={className}
        >
            <Button
                type="button"
                onClick={onClick}
                variant="secondary"
                className="size-10 rounded-full shadow-xl"
                aria-label="Scroll to bottom"
            >
                <ChevronDown className="size-4" />
            </Button>
        </motion.div>
    );
}
