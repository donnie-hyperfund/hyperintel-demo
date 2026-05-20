// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatModule } from './chat-module';

const replaceMock = vi.fn();
const activePanelProviderMock = vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>);
const artifactProviderMock = vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>);
const chatProviderMock = vi.fn(
    ({
        children,
        ...props
    }: {
        children: ReactNode;
        projectId?: string;
        chatType?: 'phase' | 'company' | 'stakeholder';
        initialChatId?: string;
        onChatCreated?: (chatId: string) => void;
    }) => <div data-props={JSON.stringify(props)}>{children}</div>,
);
const scrollTargetProviderMock = vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>);
const modelSelectionProviderMock = vi.fn(({ children }: { children: ReactNode; projectId?: string }) => (
    <div>{children}</div>
));

vi.mock('./active-panel-provider', () => ({
    ActivePanelProvider: (props: { children: ReactNode }) => activePanelProviderMock(props),
}));

vi.mock('../../artifacts/providers/artifact-provider', () => ({
    ArtifactProvider: (props: { children: ReactNode }) => artifactProviderMock(props),
}));

vi.mock('./chat-provider', () => ({
    ChatProvider: (props: {
        children: ReactNode;
        projectId?: string;
        chatType?: 'phase' | 'company' | 'stakeholder';
        initialChatId?: string;
        initialMessages?: unknown[];
        onChatCreated?: (chatId: string) => void;
    }) => chatProviderMock(props),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('./model-selection-provider', () => ({
    ModelSelectionProvider: (props: { children: ReactNode; projectId?: string }) => modelSelectionProviderMock(props),
}));

vi.mock('./scroll-target-provider', () => ({
    ScrollTargetProvider: (props: { children: ReactNode }) => scrollTargetProviderMock(props),
}));

describe('ChatModule', () => {
    it('renders children and passes provider-critical props to ChatProvider', () => {
        render(
            <ChatModule chatType="phase" projectId="project-1" initialChatId="chat-1">
                <span>module-child</span>
            </ChatModule>,
        );

        expect(screen.getByText('module-child')).toBeTruthy();
        expect(activePanelProviderMock).toHaveBeenCalledTimes(1);
        expect(artifactProviderMock).toHaveBeenCalledTimes(1);
        expect(scrollTargetProviderMock).toHaveBeenCalledTimes(1);

        expect(chatProviderMock).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-1',
                initialChatId: 'chat-1',
            }),
        );
    });

    it('passes intake chat type without project id', () => {
        render(
            <ChatModule chatType="company">
                <span>company-intake</span>
            </ChatModule>,
        );

        expect(screen.getByText('company-intake')).toBeTruthy();
        expect(chatProviderMock).toHaveBeenCalledWith(
            expect.objectContaining({
                chatType: 'company',
            }),
        );
    });

    it('uses a custom created-chat href when a chat is created', () => {
        const buildCreatedChatHref = (chatId: string) => `/companies/${chatId}?origin=project&projectId=project-1`;

        render(
            <ChatModule chatType="company" buildCreatedChatHref={buildCreatedChatHref}>
                <span>company-intake</span>
            </ChatModule>,
        );

        const providerProps = chatProviderMock.mock.calls.at(-1)?.[0];
        providerProps?.onChatCreated?.('company-chat-1');

        expect(replaceMock).toHaveBeenCalledWith('/companies/company-chat-1?origin=project&projectId=project-1', {
            scroll: false,
        });
    });
});
