import { shapeContextForInference } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { Ctx } from '../context';
import { BlurbToolGroup, createBlurbTools } from '../tools/blurb';
import { createDocumentTools } from '../tools/documents';
import { listDocuments } from '../tools/documents/document-service';
import { createKnowledgeTools } from '../tools/knowledge-search';
import { createWebScrapeTools } from '../tools/web-scrape';
import { estimateInferenceInputTokens } from '../utils/context-budget';
import { extractDocuments } from '../utils/extract-documents';
import { preprocessContext } from '../utils/preprocess-context';
import { OUTPUT_CONTRACT, TRANSITION_REQUEST_MESSAGE } from './contract';
import type { PhaseTransitionDocument } from './types';

export type PhaseTransitionPromptInput = {
    instructions: string;
    transitionMessages: Array<{ role: 'user'; content: string }>;
    documents: PhaseTransitionDocument[];
    completionBriefContent: string;
    estimatedContextTokens: number;
};

export function getPhaseTransitionInferenceParams(_contextTokens: number): ParamsWithType {
    return {
        paramsType: AIParamsType.Anthropic,
        params: {
            model: ANTHROPIC_MODELS.SONNET_4_6,
            reasoning: { exclude: true, effort: 'medium' },
            maxTokens: 64_000,
        },
    };
}

async function loadApprovedCompletionBriefContent(ctx: Ctx, chat: ChatEntity): Promise<string> {
    const cbArtifactId =
        chat.completion_brief &&
        (typeof chat.completion_brief === 'string' ? chat.completion_brief : chat.completion_brief.id);
    if (!cbArtifactId) {
        throw new Error('Approved Completion Brief content required for phase transition');
    }

    const cbArtifact = await ctx.em!.findOne(ArtifactEntity, { id: cbArtifactId }, { populate: ['current_version'] });
    const cbContent = cbArtifact?.current_version?.content;
    if (!cbContent) {
        throw new Error('Approved Completion Brief content required for phase transition');
    }

    return cbContent;
}

function buildDocumentPreviewSection(documents: PhaseTransitionDocument[]): string {
    if (documents.length === 0) return '';

    let section = '\n\n## Documents Created During This Conversation\n\n';
    for (const document of documents) {
        section += `### ${document.name}\n`;
        if (document.contentPreview) {
            section += `**Preview:**\n\`\`\`\n${document.contentPreview}\n\`\`\`\n\n`;
        }
    }
    return section;
}

async function buildDocumentStatusSection(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    documents: PhaseTransitionDocument[];
}): Promise<string> {
    const { ctx, chat, documents } = opts;
    const phaseDocNames = new Set(documents.map((document) => document.name));
    if (phaseDocNames.size === 0) return '';

    const allDocuments = await listDocuments(ctx.em!, { projectId: chat.project!.id });
    const phaseDocuments = allDocuments.filter((document) => phaseDocNames.has(document.name));
    if (phaseDocuments.length === 0) return '';

    let section =
        '\n\n## Current Document Statuses (this phase)\n\n' +
        'These statuses are queried from the database at the time of phase transition. Users may approve or reject documents via the UI — this does NOT appear in the conversation history. Use these statuses as the source of truth.\n\n';
    for (const document of phaseDocuments) {
        const status = document.hasProposed ? 'proposed' : (document.currentStatus ?? document.latestStatus);
        section += `- \`${document.name}\` (${document.title}): v${document.latestVersion}, **${status}**\n`;
    }
    return section;
}

async function buildPhaseTransitionInstructions(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    documents: PhaseTransitionDocument[];
    completionBriefContent: string;
}): Promise<string> {
    const { ctx, chat, documents, completionBriefContent } = opts;
    const phaseNumber = chat.phase_index + 1;
    const today = new Date().toISOString().split('T')[0];
    const documentStatuses = await buildDocumentStatusSection({ ctx, chat, documents });

    return [
        OUTPUT_CONTRACT,
        '---',
        '## Phase Context',
        `- **Phase Number:** ${phaseNumber}`,
        `- **Date:** ${today}`,
        buildDocumentPreviewSection(documents),
        documentStatuses,
        '\n\n## Approved Completion Brief (reference)\n\nThe following is the approved Completion Brief for this phase. Extract the next-phase initialization prompt from it and emit that prompt with the `generate_blurb` tool. Do not write any normal assistant text.\n\n',
        completionBriefContent,
    ]
        .filter(Boolean)
        .join('\n\n');
}

export async function preparePhaseTransitionPromptInput(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    chatId: string;
}): Promise<PhaseTransitionPromptInput> {
    const { ctx, chat, chatId } = opts;
    const messages = await ctx.em!.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });
    const documents = extractDocuments(messages);
    const completionBriefContent = await loadApprovedCompletionBriefContent(ctx, chat);
    const instructions = await buildPhaseTransitionInstructions({ ctx, chat, documents, completionBriefContent });
    const transitionMessages = [{ role: 'user' as const, content: TRANSITION_REQUEST_MESSAGE }];
    const blurbTools = createBlurbTools();
    const collapseToolRegistry = [...createDocumentTools(), ...createKnowledgeTools(), ...createWebScrapeTools()];
    const shapedForEstimate = shapeContextForInference({
        history: transitionMessages,
        tools: [...blurbTools],
        collapseToolRegistry,
        preprocessContext,
        ctx: null,
    });
    const estimatedContextTokens = estimateInferenceInputTokens({
        instructions,
        context: shapedForEstimate,
        tools: [...blurbTools],
        toolGroups: [BlurbToolGroup],
    });

    return { instructions, transitionMessages, documents, completionBriefContent, estimatedContextTokens };
}
