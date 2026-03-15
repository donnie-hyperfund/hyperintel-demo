'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Copy, FileJson, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { DevSlotProps } from '@/lib/dev-slots';
import { devSlots } from '@/lib/dev/dev-slots';

type Props = DevSlotProps['message-actions'];

// --- Feedback localStorage store with useSyncExternalStore ---

type FeedbackValue = 'up' | 'down' | null;

const feedbackListeners = new Set<() => void>();
let feedbackSnapshot = 0;

function notifyFeedback() {
	feedbackSnapshot++;
	for (const fn of feedbackListeners) fn();
}

function getFeedbackKey(messageId: string) {
	return `dev:feedback:${messageId}`;
}

function getFeedback(messageId: string): FeedbackValue {
	try {
		const raw = localStorage.getItem(getFeedbackKey(messageId));
		if (raw === 'up' || raw === 'down') return raw;
	} catch {}
	return null;
}

function setFeedback(messageId: string, value: FeedbackValue) {
	try {
		if (value) {
			localStorage.setItem(getFeedbackKey(messageId), value);
		} else {
			localStorage.removeItem(getFeedbackKey(messageId));
		}
	} catch {}
	notifyFeedback();
}

function subscribeFeedback(cb: () => void) {
	feedbackListeners.add(cb);
	return () => feedbackListeners.delete(cb);
}

function getFeedbackSnapshot() {
	return feedbackSnapshot;
}

// --- Tiny icon button ---

function IconButton({
	onClick,
	title,
	active,
	activeColor,
	children,
}: {
	onClick: () => void;
	title: string;
	active?: boolean;
	activeColor?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`inline-flex items-center justify-center rounded p-1 transition-colors ${
				active ? (activeColor ?? 'text-blue-400') : 'text-neutral-500 hover:text-neutral-300'
			}`}
		>
			{children}
		</button>
	);
}

// --- Main component ---

function MessageFeedback({ messageId, content, role, blocks }: Props) {
	// Subscribe to feedback changes so toggle re-renders
	useSyncExternalStore(subscribeFeedback, getFeedbackSnapshot, getFeedbackSnapshot);
	const feedback = getFeedback(messageId);
	const isUser = role === 'user';

	const copyText = useCallback(() => {
		navigator.clipboard.writeText(content);
	}, [content]);

	const copyBlocks = useCallback(() => {
		if (!blocks?.length) return;
		navigator.clipboard.writeText(JSON.stringify(blocks, null, 2));
	}, [blocks]);

	const toggleUp = useCallback(() => {
		setFeedback(messageId, feedback === 'up' ? null : 'up');
	}, [messageId, feedback]);

	const toggleDown = useCallback(() => {
		setFeedback(messageId, feedback === 'down' ? null : 'down');
	}, [messageId, feedback]);

	return (
		<div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
			<IconButton onClick={copyText} title="Copy text">
				<Copy size={14} />
			</IconButton>
			{!isUser && blocks && blocks.length > 0 && (
				<IconButton onClick={copyBlocks} title="Copy blocks as JSON">
					<FileJson size={14} />
				</IconButton>
			)}
			{!isUser && (
				<>
					<IconButton onClick={toggleUp} title="Thumbs up" active={feedback === 'up'} activeColor="text-green-400">
						<ThumbsUp size={14} />
					</IconButton>
					<IconButton onClick={toggleDown} title="Thumbs down" active={feedback === 'down'} activeColor="text-red-400">
						<ThumbsDown size={14} />
					</IconButton>
				</>
			)}
		</div>
	);
}

// Register into the message-actions slot at module load
devSlots.register('message-actions', MessageFeedback);
