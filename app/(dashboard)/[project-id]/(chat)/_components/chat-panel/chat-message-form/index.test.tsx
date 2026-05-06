// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getContextBypassForChat, setContextBypassForChat } from '@/modules/chat/utils/context-bypass-session';
import ChatMessageForm from './index';

const dismissContextLimitAlertMock = vi.fn();
const dismissContextWarningModalMock = vi.fn();
const dismissHardStopModalMock = vi.fn();
const dismissInvalidModelAlertMock = vi.fn();
const navigateToExistingNextChatMock = vi.fn();
const requestPhaseTransitionMock = vi.fn();
const sendForceBriefMock = vi.fn();
const sendMessageMock = vi.fn();
const stopGenerationMock = vi.fn();
const saveDraftMock = vi.fn();
const clearDraftMock = vi.fn();

let chatTypeMock: 'phase' | 'company' = 'phase';
let showContextLimitAlertMock = true;
let showContextWarningModalMock = false;
let hardStopModalStateMock: 'closed' | 'idle' | 'forcing' | 'already-transitioned' = 'closed';
let hardStopExistingNextChatIdMock: string | null = null;
let hardStopErrorMock: string | null = null;

vi.mock('@/components/ui/alert-dialog', () => ({
    AlertDialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (open ? <div>{children}</div> : null),
    AlertDialogAction: ({
        children,
        onClick,
    }: {
        children: ReactNode;
        onClick?: React.MouseEventHandler<HTMLButtonElement>;
    }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
    AlertDialogCancel: ({
        children,
        onClick,
    }: {
        children: ReactNode;
        onClick?: React.MouseEventHandler<HTMLButtonElement>;
    }) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/modules/chat/providers/chat-provider', () => ({
    useChatContext: () => ({
        sendMessage: sendMessageMock,
        chatType: chatTypeMock,
        chatId: 'chat-1',
        projectId: chatTypeMock === 'phase' ? 'project-1' : undefined,
        stopGeneration: stopGenerationMock,
        dismissInvalidModelAlert: dismissInvalidModelAlertMock,
        dismissContextLimitAlert: dismissContextLimitAlertMock,
        dismissContextWarningModal: dismissContextWarningModalMock,
        sendForceBrief: sendForceBriefMock,
        dismissHardStopModal: dismissHardStopModalMock,
        navigateToExistingNextChat: navigateToExistingNextChatMock,
        requestPhaseTransition: requestPhaseTransitionMock,
        state: {
            isGenerating: false,
            isSummarizing: false,
            isLoading: false,
            isProcessingArtifactAction: false,
            tokenUsage: null,
            activeResponseId: null,
            showInvalidModelAlert: false,
            showContextLimitAlert: showContextLimitAlertMock,
            showContextWarningModal: showContextWarningModalMock,
            hardStopModalState: hardStopModalStateMock,
            hardStopExistingNextChatId: hardStopExistingNextChatIdMock,
            hardStopError: hardStopErrorMock,
        },
    }),
}));

vi.mock('@/modules/chat/providers/model-selection-provider', () => ({
    useModelSelection: () => ({ selectedModel: 'sonnet' }),
}));

vi.mock('@/modules/file-uploads/providers/file-upload-provider', () => ({
    useFileUploadContext: () => ({
        files: [],
        addFiles: vi.fn(),
        removeFile: vi.fn(),
        submitFiles: vi.fn(),
        waitForArtifactsReady: vi.fn(),
        isSubmitting: false,
        getMessageAttachments: vi.fn(() => ({
            artifactIds: [],
            requiresAssociationIds: [],
            imageFileIds: [],
        })),
    }),
}));

vi.mock('@/modules/chat/hooks/use-chat-draft', () => ({
    useChatDraft: () => ({
        initialDraft: '',
        saveDraft: saveDraftMock,
        clearDraft: clearDraftMock,
    }),
}));

vi.mock('../context-usage-indicator', () => ({
    ContextUsageIndicator: () => null,
}));

vi.mock('./attach-file-button', () => ({
    AttachFileButton: () => null,
}));

vi.mock('./file-preview-item/file-preview-item', () => ({
    FilePreviewItem: () => null,
}));

vi.mock('./switch-model-selector', () => ({
    SwitchModelSelector: () => null,
}));

describe('ChatMessageForm context-limit alert', () => {
    beforeEach(() => {
        dismissContextLimitAlertMock.mockReset();
        dismissContextWarningModalMock.mockReset();
        dismissHardStopModalMock.mockReset();
        dismissInvalidModelAlertMock.mockReset();
        navigateToExistingNextChatMock.mockReset();
        requestPhaseTransitionMock.mockReset();
        sendForceBriefMock.mockReset();
        sendMessageMock.mockReset();
        sendMessageMock.mockResolvedValue(undefined);
        stopGenerationMock.mockReset();
        saveDraftMock.mockReset();
        clearDraftMock.mockReset();
        sessionStorage.clear();
        chatTypeMock = 'phase';
        showContextLimitAlertMock = true;
        showContextWarningModalMock = false;
        hardStopModalStateMock = 'closed';
        hardStopExistingNextChatIdMock = null;
        hardStopErrorMock = null;
    });

    it('continues phase chats by dismissing the alert and requesting phase transition', () => {
        render(<ChatMessageForm />);

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(dismissContextLimitAlertMock).toHaveBeenCalledTimes(1);
        expect(requestPhaseTransitionMock).toHaveBeenCalledTimes(1);
    });

    it('shows an intake-only acknowledgement without requesting phase transition', () => {
        chatTypeMock = 'company';

        render(<ChatMessageForm />);

        expect(
            screen.getByText(
                'This conversation has reached the context limit. Start a new conversation before continuing.',
            ),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'OK' }));

        expect(dismissContextLimitAlertMock).toHaveBeenCalledTimes(1);
        expect(requestPhaseTransitionMock).not.toHaveBeenCalled();
    });

    it('continues from the soft warning by resending the current draft with bypass', async () => {
        showContextLimitAlertMock = false;
        showContextWarningModalMock = true;

        render(<ChatMessageForm />);

        fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'keep going' } });
        fireEvent.click(screen.getByRole('checkbox', { name: "don't remind me again this session" }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => {
            expect(sendMessageMock).toHaveBeenCalledWith('keep going', { bypassContextWarning: true });
        });
        expect(dismissContextWarningModalMock).toHaveBeenCalledTimes(1);
        expect(getContextBypassForChat('chat-1')).toBe(true);
    });

    it('auto-attaches bypass on submit when the chat has a session bypass flag', async () => {
        showContextLimitAlertMock = false;
        setContextBypassForChat('chat-1');

        render(<ChatMessageForm />);

        const textbox = screen.getByPlaceholderText('Type your message...');
        fireEvent.change(textbox, { target: { value: 'next message' } });
        fireEvent.submit(textbox.closest('form')!);

        await waitFor(() => {
            expect(sendMessageMock).toHaveBeenCalledWith('next message', { bypassContextWarning: true });
        });
    });

    it('soft-warning does not expose the Next phase action', () => {
        showContextLimitAlertMock = false;
        showContextWarningModalMock = true;

        render(<ChatMessageForm />);

        expect(screen.queryByRole('button', { name: 'Next phase' })).toBeNull();
        expect(requestPhaseTransitionMock).not.toHaveBeenCalled();
        expect(sendForceBriefMock).not.toHaveBeenCalled();
    });

    it('hard-stop confirmation sends the forced brief nudge', () => {
        showContextLimitAlertMock = false;
        hardStopModalStateMock = 'idle';

        render(<ChatMessageForm />);

        fireEvent.click(screen.getByRole('button', { name: 'Yes, create Completion Brief' }));

        expect(sendForceBriefMock).toHaveBeenCalledTimes(1);
    });

    it('already-transitioned hard stop navigates to the existing next phase', () => {
        showContextLimitAlertMock = false;
        hardStopModalStateMock = 'already-transitioned';
        hardStopExistingNextChatIdMock = 'chat-next';

        render(<ChatMessageForm />);

        fireEvent.click(screen.getByRole('button', { name: 'Go to next phase' }));

        expect(navigateToExistingNextChatMock).toHaveBeenCalledTimes(1);
        expect(sendForceBriefMock).not.toHaveBeenCalled();
    });
});
