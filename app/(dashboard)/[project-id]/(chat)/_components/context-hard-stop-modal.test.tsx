// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextHardStopModal } from './context-hard-stop-modal';

const onConfirm = vi.fn();
const onCancel = vi.fn();
const onNavigate = vi.fn();

describe('ContextHardStopModal', () => {
    beforeEach(() => {
        onConfirm.mockReset();
        onCancel.mockReset();
        onNavigate.mockReset();
    });

    it('confirms forced Completion Brief generation from idle state', () => {
        render(<ContextHardStopModal open state="idle" onConfirm={onConfirm} onCancel={onCancel} />);

        fireEvent.click(screen.getByRole('button', { name: 'Yes, create Completion Brief' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables actions and shows progress while forcing', () => {
        render(<ContextHardStopModal open state="forcing" onConfirm={onConfirm} onCancel={onCancel} />);

        expect(screen.getByRole('button', { name: /Working/ })).toHaveProperty('disabled', true);
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    });

    it('surfaces forced-transition errors in the modal', () => {
        render(
            <ContextHardStopModal
                open
                state="idle"
                error="Summary failed"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );

        expect(screen.getByText('Summary failed')).toBeTruthy();
    });

    it('navigates instead of forcing when the phase already transitioned', () => {
        render(
            <ContextHardStopModal
                open
                state="already-transitioned"
                existingNextChatId="chat-next"
                onConfirm={onConfirm}
                onCancel={onCancel}
                onNavigate={onNavigate}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Yes, create Completion Brief' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Go to next phase' }));

        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
