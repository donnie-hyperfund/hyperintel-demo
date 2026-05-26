import { AIParamsType, runInferenceNoStream } from '@common/ai/inference';
import { COMMON_MODELS } from '@common/ai/types';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { Ctx } from '../context';
import type { UserGatewayStub } from '../utils/do-stubs';
import { PENDING_PHASE_MESSAGE_METADATA_KEY, type PhaseTransitionDocument } from './types';

export async function createNextPhaseChat(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    sourceChatId: string;
    documents: PhaseTransitionDocument[];
    blurbContent: string;
}): Promise<ChatEntity> {
    const { ctx, chat, sourceChatId, documents, blurbContent } = opts;
    const initialMessageId = crypto.randomUUID();
    const newChat = ctx.em!.create(ChatEntity, {
        project: chat.project!.id,
        phase: chat.phase,
        phase_index: await ctx.em!.count(ChatEntity, { project: chat.project!.id }),
        metadata: {
            transitionedFrom: sourceChatId,
            transitionedAt: new Date().toISOString(),
            documents,
            [PENDING_PHASE_MESSAGE_METADATA_KEY]: initialMessageId,
        },
    });
    ctx.em!.persist(newChat);
    ctx.em!.persist(
        ctx.em!.create(ChatMessageEntity, {
            id: initialMessageId,
            chat: newChat,
            role: 'user',
            content: blurbContent,
            metadata: { synthetic: true, reason: 'phase_transition_initial_prompt' },
        }),
    );

    chat.active_agent_message_id = null;
    await ctx.em!.flush();

    return newChat;
}

export async function nameSourcePhaseIfMissing(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    documents: PhaseTransitionDocument[];
    completionBriefContent: string;
    blurbContent: string;
}) {
    const { ctx, chat, documents, completionBriefContent, blurbContent } = opts;
    if (chat.name) return;

    try {
        const substantiveDocs = documents.filter(
            (document) => !document.name.toLowerCase().includes('completion brief'),
        );
        const docContext =
            substantiveDocs.length > 0
                ? `\n\nDocuments generated during this phase:\n${substantiveDocs.map((document) => `- ${document.name}`).join('\n')}`
                : '';
        const titleContext = [
            'Approved Completion Brief:',
            completionBriefContent,
            '',
            'Next-phase initialization prompt:',
            blurbContent,
            docContext,
        ].join('\n');

        const nameResult = await runInferenceNoStream(ctx, {
            paramsType: AIParamsType.OpenRouter,
            instructions:
                'You are a concise title generator for completed conversation phases. Given the approved Completion Brief, next-phase initialization prompt, and optionally a list of generated documents, produce a short title (4-6 words) for the phase that just ended. If documents were generated, prioritize the actual substantive documents and outcomes. If the phase has no meaningful completed work, return "Empty phase" — do not make up a title. CRITICAL: Ignore the Completion Brief as a document name; it is generated automatically and is not the substantive outcome. Never include phase numbers or phase names like "Phase 1" in the title. Return ONLY the title, no quotes, no punctuation at the end.',
            context: [{ role: 'user', content: titleContext }],
            params: {
                model: COMMON_MODELS.GPT_5_4_NANO,
                maxTokens: 30,
            },
        });

        if (nameResult.status === 'error') {
            throw new Error(nameResult.error?.message ?? 'Failed to generate phase name');
        }

        if (nameResult.status === 'success' && nameResult.result) {
            chat.name = (nameResult.result as string).trim().slice(0, 100);
            await ctx.em!.flush();
        }
    } catch (error) {
        console.error('[phase-transition] failed to generate phase name:', error);
    }
}

export function broadcastNextPhaseCreated(opts: { ugStub: UserGatewayStub; newChat: ChatEntity; projectId: string }) {
    const { ugStub, newChat, projectId } = opts;
    ugStub
        .broadcastToAll({
            type: 'user_event',
            eventType: 'chat_created',
            payload: { chatId: newChat.id, projectId },
        })
        .catch(console.error);
}
