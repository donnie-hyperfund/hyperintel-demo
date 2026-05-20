'use client';

import {
    forwardRef,
    TextareaHTMLAttributes,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from 'react';
import { cn } from '@/lib/utils';

export type AutoExpandingTextareaRef = {
    updateTextareaHeight: () => void;
} & HTMLTextAreaElement;

type AutoExpandingTextareaProps = {
    maxHeight?: number;
    minHeight?: number;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

const AutoExpandingTextarea = forwardRef<AutoExpandingTextareaRef, AutoExpandingTextareaProps>(
    ({ className, maxHeight = 144, minHeight = 20, onInput, value, ...props }, ref) => {
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const previousLengthRef = useRef(0);

        const updateTextareaHeight = useCallback(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;

            // Skip collapse on grow — avoids a layout flash that clamps any ancestor scroll container.
            const length = textarea.value.length;
            if (length < previousLengthRef.current) {
                textarea.style.height = '0px';
            }
            previousLengthRef.current = length;

            textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        }, [maxHeight]);

        useImperativeHandle(ref, () => {
            const textarea = textareaRef.current;
            if (!textarea) return null as unknown as AutoExpandingTextareaRef;
            return Object.assign(textarea, {
                updateTextareaHeight,
            });
        }, [updateTextareaHeight]);

        const handleInput = useCallback(
            (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                updateTextareaHeight();
                onInput?.(e);
            },
            [updateTextareaHeight, onInput],
        );

        // Reset height when the component receives a new empty value
        useEffect(() => {
            const textarea = textareaRef.current;
            if (textarea && value === '') {
                textarea.style.height = `${minHeight}px`;
            }
        }, [value, minHeight]);

        useLayoutEffect(() => {
            updateTextareaHeight();
        }, [updateTextareaHeight]);

        return (
            <textarea
                ref={textareaRef}
                className={cn('resize-none overflow-y-auto', className)}
                // Inline height matches minHeight so SSR + first paint don't render at the browser's default rows-based height (~40px for 2 rows) before useLayoutEffect adjusts — avoids a layout shift in the form area on cold load.
                style={{ minHeight: `${minHeight}px`, height: `${minHeight}px` }}
                onInput={handleInput}
                value={value}
                {...props}
            />
        );
    },
);

AutoExpandingTextarea.displayName = 'AutoExpandingTextarea';

export { AutoExpandingTextarea };
