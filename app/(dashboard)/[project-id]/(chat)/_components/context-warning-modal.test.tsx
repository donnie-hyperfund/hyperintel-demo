// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextWarningModal } from './context-warning-modal';

const onContinue = vi.fn();
const onNextPhase = vi.fn();
const onCancel = vi.fn();

describe('ContextWarningModal', () => {
    beforeEach(() => {
        onContinue.mockReset();
        onNextPhase.mockReset();
        onCancel.mockReset();
    });

    it('passes the dont-remind choice when continuing', () => {
        render(<ContextWarningModal open onContinue={onContinue} onNextPhase={onNextPhase} onCancel={onCancel} />);

        expect(screen.getByText(/quality can deteriorate/)).toBeTruthy();
        fireEvent.click(screen.getByRole('checkbox', { name: "don't remind me again this session" }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(onContinue).toHaveBeenCalledWith(true);
        expect(onNextPhase).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('does not expose Next phase and only Cancel closes it', () => {
        render(<ContextWarningModal open onContinue={onContinue} onNextPhase={onNextPhase} onCancel={onCancel} />);

        expect(screen.queryByRole('button', { name: 'Next phase' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onNextPhase).not.toHaveBeenCalled();
    });

    it('does not cancel on Escape or focus a button by default', () => {
        render(<ContextWarningModal open onContinue={onContinue} onNextPhase={onNextPhase} onCancel={onCancel} />);

        const continueButton = screen.getByRole('button', { name: 'Continue' });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

        expect(onCancel).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(continueButton);
    });
});
