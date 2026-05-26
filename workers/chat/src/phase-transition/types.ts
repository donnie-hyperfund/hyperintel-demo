import type { ParamsWithType } from '@common/ai/inference';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { PhaseTransitionActionDto } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../context';
import type { UserGatewayStub } from '../utils/do-stubs';
import type { PhaseDocument } from '../utils/phase-documents';
import type { setupStreamInfra } from '../utils/stream-runner';

export const PHASE_TRANSITION_STREAM_TYPE = 'phase_transition' as const;
export const PENDING_PHASE_MESSAGE_METADATA_KEY = 'pendingInitialMessageId';

export interface PhaseTransitionOptions {
    overrideInference?: ParamsWithType;
    /** Event tap — called with each StreamEvent during generation. For tests. */
    onEvent?: (event: StreamEvent) => void;
}

export interface PhaseTransitionContext {
    data: PhaseTransitionActionDto;
    ctx: Ctx;
    options: PhaseTransitionOptions;
    chat: ChatEntity;
    agentMessageId: string;
    ugStub: UserGatewayStub;
}

export type PhaseTransitionResult = boolean;

export type PhaseTransitionDocument = PhaseDocument;
export type PhaseTransitionInfra = ReturnType<typeof setupStreamInfra>;
