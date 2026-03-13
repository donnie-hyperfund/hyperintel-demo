// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChatModule } from './chat-module';

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
        chatRouteBuilder?: (chatId: string) => string;
    }) => <div data-props={JSON.stringify(props)}>{children}</div>,
);
const scrollTargetProviderMock = vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>);

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
        chatRouteBuilder?: (chatId: string) => string;
    }) => chatProviderMock(props),
}));

vi.mock('./scroll-target-provider', () => ({
    ScrollTargetProvider: (props: { children: ReactNode }) => scrollTargetProviderMock(props),
}));

describe('ChatModule', () => {
    it('renders children and passes provider-critical props to ChatProvider', () => {
        render(
            <ChatModule projectId="project-1" initialChatId="chat-1">
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

    it('passes a custom chat route builder to ChatProvider', () => {
        const chatRouteBuilder = (chatId: string) => `/companies/${chatId}?origin=project&projectId=project-1`;

        render(
            <ChatModule chatType="company" chatRouteBuilder={chatRouteBuilder}>
                <span>company-intake</span>
            </ChatModule>,
        );

        expect(chatProviderMock).toHaveBeenCalledWith(
            expect.objectContaining({
                chatType: 'company',
                chatRouteBuilder,
            }),
        );
    });
});
