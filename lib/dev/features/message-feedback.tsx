'use client';

import { Copy, FileJson, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { devSlots } from '@/lib/dev/dev-slots';
import type { DevSlotProps } from '@/lib/dev-slots';

type Props = DevSlotProps['message-actions'];

type FeedbackState = {
	score: boolean | null;
	comment: string | null;
	saving: boolean;
};

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

// --- API ---

async function saveFeedback(chatId: string, messageId: string, score: boolean | null, comment?: string | null) {
	await fetch(`/api/chats/${chatId}/messages/${messageId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ feedback_score: score, feedback: comment ?? null }),
	});
}

// --- Main component ---

function MessageFeedback({ chatId, messageId, content, role, blocks, feedbackScore, feedbackComment }: Props) {
	const [feedback, setFeedback] = useState<FeedbackState>(() => ({
		score: feedbackScore ?? null,
		comment: feedbackComment ?? null,
		saving: false,
	}));
	const [modalOpen, setModalOpen] = useState(false);
	const commentRef = useRef<HTMLTextAreaElement>(null);
	const isUser = role === 'user';

	const copyText = useCallback(() => {
		navigator.clipboard.writeText(content);
	}, [content]);

	const copyBlocks = useCallback(() => {
		if (!blocks?.length) return;
		navigator.clipboard.writeText(JSON.stringify(blocks, null, 2));
	}, [blocks]);

	const handleThumbsUp = useCallback(async () => {
		if (!chatId) return;
		const newScore = feedback.score === true ? null : true;
		setFeedback((prev) => ({ ...prev, score: newScore, saving: true }));
		await saveFeedback(chatId, messageId, newScore, newScore === null ? null : feedback.comment);
		setFeedback((prev) => ({ ...prev, saving: false }));
	}, [chatId, messageId, feedback.score, feedback.comment]);

	const handleThumbsDown = useCallback(() => {
		if (feedback.score === false) {
			// Already down — toggle off
			if (!chatId) return;
			setFeedback((prev) => ({ ...prev, score: null, comment: null, saving: true }));
			// TODO: handle save rejection so the saving state cannot get stuck.
			void saveFeedback(chatId, messageId, null, null).then(() => {
				setFeedback((prev) => ({ ...prev, saving: false }));
			});
			return;
		}
		setModalOpen(true);
	}, [chatId, messageId, feedback.score]);

	const submitDownFeedback = useCallback(async () => {
		if (!chatId) return;
		const comment = commentRef.current?.value.trim() || null;
		setFeedback({ score: false, comment, saving: true });
		setModalOpen(false);
		await saveFeedback(chatId, messageId, false, comment);
		setFeedback((prev) => ({ ...prev, saving: false }));
	}, [chatId, messageId]);

	return (
		<>
			<div className="mt-1 flex items-center gap-1">
				<span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
					<IconButton onClick={copyText} title="Copy text">
						<Copy size={14} />
					</IconButton>
				</span>
				{!isUser && blocks && blocks.length > 0 && (
					<span className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
						<IconButton onClick={copyBlocks} title="Copy blocks as JSON">
							<FileJson size={14} />
						</IconButton>
					</span>
				)}
				{!isUser && (
					// biome-ignore lint/complexity/noUselessFragments: it's not useless
					<>
						{feedback.saving ? (
							<span className="inline-flex items-center justify-center p-1 text-neutral-500">
								<Loader2 size={14} className="animate-spin" />
							</span>
						) : (
							<>
								<span className={feedback.score === true ? 'opacity-40 group-hover:opacity-100 transition-opacity duration-150' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}>
									<IconButton
										onClick={handleThumbsUp}
										title="Good response"
										active={feedback.score === true}
										activeColor="text-green-400"
									>
										<ThumbsUp size={14} />
									</IconButton>
								</span>
								<span className={feedback.score === false ? 'opacity-40 group-hover:opacity-100 transition-opacity duration-150' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}>
									<IconButton
										onClick={handleThumbsDown}
										title={feedback.score === false && feedback.comment ? `Bad response: ${feedback.comment}` : 'Bad response'}
										active={feedback.score === false}
										activeColor="text-red-400"
									>
										<ThumbsDown size={14} />
									</IconButton>
								</span>
							</>
						)}
					</>
				)}
			</div>

			<Dialog open={modalOpen} onOpenChange={setModalOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>What went wrong?</DialogTitle>
						<DialogDescription>Optional — describe what was bad about this response.</DialogDescription>
					</DialogHeader>
					<textarea
						ref={commentRef}
						placeholder="e.g. hallucinated facts, wrong format, missed context..."
						className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
						rows={3}
					/>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setModalOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={submitDownFeedback}>
							Submit
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// Register into the message-actions slot at module load
devSlots.register('message-actions', MessageFeedback);
