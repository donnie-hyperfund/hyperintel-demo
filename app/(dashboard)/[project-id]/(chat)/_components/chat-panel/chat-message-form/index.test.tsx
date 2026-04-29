// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatMessageForm from './index';

const dismissContextLimitAlertMock = vi.fn();
const dismissInvalidModelAlertMock = vi.fn();
const requestPhaseTransitionMock = vi.fn();
const sendMessageMock = vi.fn();
const stopGenerationMock = vi.fn();
const saveDraftMock = vi.fn();
const clearDraftMock = vi.fn();

let chatTypeMock: 'phase' | 'company' = 'phase';
let showContextLimitAlertMock = true;

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
        consumeStagedArtifactIds: vi.fn(),
        consumeStagedImageFileIds: vi.fn(),
        consumeDraftArtifactIds: vi.fn(),
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
        dismissInvalidModelAlertMock.mockReset();
        requestPhaseTransitionMock.mockReset();
        sendMessageMock.mockReset();
        stopGenerationMock.mockReset();
        saveDraftMock.mockReset();
        clearDraftMock.mockReset();
        chatTypeMock = 'phase';
        showContextLimitAlertMock = true;
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
});
