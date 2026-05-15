import { PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { approveArtifactProgrammatic } from './artifact-approver';
import { type ForceBriefDeps, handleForceBrief } from './chat-brief-handler';
import { runPhaseTransition } from './phase-transition';
import { broadcastUserEvent } from './utils/broadcast';

vi.mock('./artifact-approver', () => ({
    approveArtifactProgrammatic: vi.fn(),
}));

vi.mock('./phase-transition', () => ({
    runPhaseTransition: vi.fn(),
}));

vi.mock('./utils/broadcast', () => ({
    broadcastUserEvent: vi.fn(),
}));

interface BuildHarnessOpts {
    chatStatus?: string | null;
    nextChat?: { id: string } | null;
    proposedVersion?: { id: string; version?: number } | null;
    throwOnVersionLookup?: Error;
}

function buildHarness({
    chatStatus = null,
    nextChat = null,
    proposedVersion = null,
    throwOnVersionLookup,
}: BuildHarnessOpts = {}) {
    const chat = {
        id: 'chat-1',
        project: { id: 'project-1' },
        metadata: {},
        completion_brief_status: chatStatus,
        completion_brief: proposedVersion ? { id: 'cb-artifact-1' } : null,
        active_agent_message_id: null,
    } as any;

    const em = {
        findOne: vi.fn(async (entity: unknown) => {
            if (entity === ChatEntity) return nextChat;
            if (entity === ArtifactVersionEntity && throwOnVersionLookup) throw throwOnVersionLookup;
            if (entity === ArtifactVersionEntity) return proposedVersion;
            return null;
        }),
        create: vi.fn((_entity: unknown, data: Record<string, unknown>) => ({
            ...data,
            toJSON: () => data,
        })),
        persist: vi.fn(),
        flush: vi.fn(async () => undefined),
    };

    const ugStub = {
        systemAction: vi.fn(async () => undefined),
        broadcastToAll: vi.fn(async () => undefined),
    };
    const chatServices = {
        systemAction: vi.fn(async () => undefined),
    };

    const ctx = {
        em,
        env: {
            USER_GATEWAY: {
                idFromName: vi.fn(() => 'ug-id'),
                get: vi.fn(() => ugStub),
            },
            CHAT_SERVICES: chatServices,
            STREAM_AE: { writeDataPoint: vi.fn() },
            WORKER_NAME: 'hi-chat-test',
            WORKER_NAME_FULL: 'hi-chat-test',
        },
        user: { userId: 'user-1' },
        previewAlias: null,
    } as any;

    const deps: ForceBriefDeps = {
        prepareChatGenerationInput: vi.fn(async () => ({
            allTools: [],
            toolGroups: [],
            promptSlugsForRun: [],
            localPath: null,
            estimatedTokens: 301_000,
            contextMessages: [],
        })),
        runGeneration: vi.fn(async () => undefined),
    };

    return { chat, ctx, em, ugStub, deps };
}

async function forceBrief(harness: ReturnType<typeof buildHarness>) {
    return handleForceBrief({
        data: { chatId: 'chat-1', message: null, model: 'sonnet', force_brief: true },
        ctx: harness.ctx,
        options: { onEvent: vi.fn() },
        chat: harness.chat,
        deps: harness.deps,
    });
}

function transitionEvents() {
    return vi
        .mocked(broadcastUserEvent)
        .mock.calls.filter(([, eventName]) => eventName === 'context_limit_transition_update')
        .map(([, , payload]) => payload as Record<string, unknown>);
}

describe('handleForceBrief', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(approveArtifactProgrammatic).mockResolvedValue({
            success: true,
            version: 1,
            status: 'approved',
            chatId: 'chat-1',
            chatType: 'phase',
        });
        vi.mocked(runPhaseTransition).mockResolvedValue(true);
    });

    it('refuses already-transitioned chats without mutating forced-flow state', async () => {
        const harness = buildHarness({ nextChat: { id: 'next-chat-1' } });

        const result = await forceBrief(harness);

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CONTEXT_TOO_LONG');
        expect((result as PublicError).details).toMatchObject({
            gate: 'hard',
            source: 'already_transitioned',
            canForceBrief: false,
            existingNextChatId: 'next-chat-1',
        });
        expect(harness.deps.runGeneration).not.toHaveBeenCalled();
        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(broadcastUserEvent).not.toHaveBeenCalled();
    });

    it('approves an existing proposed CB and starts the phase transition without generation', async () => {
        const harness = buildHarness({
            chatStatus: 'proposed',
            proposedVersion: { id: 'cb-version-1', version: 3 },
        });

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(harness.deps.runGeneration).not.toHaveBeenCalled();
        expect(approveArtifactProgrammatic).toHaveBeenCalledWith(harness.ctx, 'cb-version-1', {
            reason: 'context_hard_gate',
        });
        expect(runPhaseTransition).toHaveBeenCalledOnce();
        expect(transitionEvents().map((event) => event.status)).toEqual([
            'approving_brief',
            'starting_transition',
            'transitioning',
        ]);
        expect(harness.chat.metadata.contextLimitTransition).toBeUndefined();
    });

    it('starts the phase transition for an approved CB without re-approving', async () => {
        const harness = buildHarness({ chatStatus: 'approved' });

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(harness.deps.runGeneration).not.toHaveBeenCalled();
        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).toHaveBeenCalledOnce();
        expect(transitionEvents().map((event) => event.status)).toEqual(['starting_transition', 'transitioning']);
    });

    it('State D persists a synthetic message, approves the produced CB, then transitions', async () => {
        const proposedVersion = { id: 'cb-version-1', version: 1 };
        const harness = buildHarness({ proposedVersion });
        harness.chat.completion_brief = null;
        vi.mocked(harness.deps.runGeneration).mockImplementation(async () => {
            harness.chat.completion_brief = { id: 'cb-artifact-1' };
        });

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(harness.em.create).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                role: 'user',
                metadata: { synthetic: true, reason: 'context_hard_gate' },
            }),
        );
        expect(harness.deps.prepareChatGenerationInput).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    force_brief: true,
                    message: expect.stringContaining('Generate the Completion Brief now'),
                }),
            }),
        );
        expect(harness.deps.runGeneration).toHaveBeenCalledOnce();
        expect(approveArtifactProgrammatic).toHaveBeenCalledWith(harness.ctx, 'cb-version-1', {
            reason: 'context_hard_gate',
        });
        expect(runPhaseTransition).toHaveBeenCalledOnce();
        expect(transitionEvents().map((event) => event.status)).toEqual([
            'generating_brief',
            'approving_brief',
            'starting_transition',
            'transitioning',
        ]);
        expect(harness.chat.metadata.contextLimitTransition).toBeUndefined();
    });

    it('State D marks NO_CB_PRODUCED and does not transition when generation creates no CB', async () => {
        const harness = buildHarness();

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'NO_CB_PRODUCED',
        });
        expect(transitionEvents().at(-1)).toMatchObject({
            status: 'failed',
            errorCode: 'NO_CB_PRODUCED',
        });
    });

    it('State D marks CONTEXT_OVERFLOW when generation records overflow and creates no CB', async () => {
        const harness = buildHarness();
        vi.mocked(harness.deps.runGeneration).mockImplementation(async () => {
            harness.chat.metadata.contextOverflow = 'hard';
        });

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'CONTEXT_OVERFLOW',
        });
    });

    it('State D marks PREFLIGHT_REJECTED when synthetic generation input is rejected', async () => {
        const harness = buildHarness();
        vi.mocked(harness.deps.prepareChatGenerationInput).mockResolvedValue(
            new PublicError(400, {
                code: 'CONTEXT_TOO_LONG',
                message: 'preflight rejected',
            }),
        );

        const result = await forceBrief(harness);

        expect(result).toBeInstanceOf(PublicError);
        expect(harness.deps.runGeneration).not.toHaveBeenCalled();
        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'PREFLIGHT_REJECTED',
            message: 'preflight rejected',
        });
    });

    it('State D marks CB_LOOKUP_FAILED when produced-CB lookup throws', async () => {
        const harness = buildHarness({ throwOnVersionLookup: new Error('lookup broke') });
        vi.mocked(harness.deps.runGeneration).mockImplementation(async () => {
            harness.chat.completion_brief = { id: 'cb-artifact-1' };
        });

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'CB_LOOKUP_FAILED',
            message: 'lookup broke',
        });
    });

    it('State D marks CB_APPROVAL_FAILED when auto-approval throws', async () => {
        const proposedVersion = { id: 'cb-version-1', version: 1 };
        const harness = buildHarness({ proposedVersion });
        harness.chat.completion_brief = null;
        vi.mocked(harness.deps.runGeneration).mockImplementation(async () => {
            harness.chat.completion_brief = { id: 'cb-artifact-1' };
        });
        vi.mocked(approveArtifactProgrammatic).mockRejectedValue(new Error('approval broke'));

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'CB_APPROVAL_FAILED',
            message: 'approval broke',
        });
    });

    it('State A returns INCONSISTENT_STATE when chat says proposed but no proposed CB version exists', async () => {
        const harness = buildHarness({ chatStatus: 'proposed', proposedVersion: null });

        const result = await forceBrief(harness);

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('INCONSISTENT_STATE');
        expect(approveArtifactProgrammatic).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
    });

    it('State A returns CB_APPROVAL_FAILED and persists a failed marker when auto-approval throws', async () => {
        const harness = buildHarness({
            chatStatus: 'proposed',
            proposedVersion: { id: 'cb-version-1', version: 3 },
        });
        vi.mocked(approveArtifactProgrammatic).mockRejectedValue(new Error('approval broke'));

        const result = await forceBrief(harness);

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CB_APPROVAL_FAILED');
        expect(runPhaseTransition).not.toHaveBeenCalled();
        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'CB_APPROVAL_FAILED',
            message: 'approval broke',
        });
    });

    it('persists SUMMARY_FAILED when the phase transition returns false', async () => {
        const harness = buildHarness({ chatStatus: 'approved' });
        vi.mocked(runPhaseTransition).mockResolvedValue(false);

        const result = await forceBrief(harness);
        await (result as { generation: Promise<void> }).generation;

        expect(harness.chat.metadata.contextLimitTransition).toMatchObject({
            status: 'failed',
            errorCode: 'SUMMARY_FAILED',
        });
    });
});
