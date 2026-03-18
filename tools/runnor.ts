/**
 * runnor.ts - REPL-style test harness for chat-handler.ts
 *
 * Run with: npx tsx tools/runnor.ts
 */

import { serializeException } from '@common/ai';
import { AIParamsType } from '@common/ai/inference';
import { ANTHROPIC_MODELS, COMMON_MODELS } from '@common/ai/types';
import logUpdate from 'log-update';
import * as readline from 'readline';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import type { StreamEvent } from '@/lib/schema/stream';
import { type ChatHandlerOptions, chatActionHandler } from '@/workers/chat/src/chat-handler';

const overrideOpts: ChatHandlerOptions = {
    // useLocalPrompts: true,
    overrideInference: {
        paramsType: AIParamsType.Anthropic,
        params: { model: ANTHROPIC_MODELS.SONNET, thinking: true, thinkingBudget: 8000, searchEnabled: true },
        //paramsType: AIParamsType.OpenRouter,
        //params: { model: COMMON_MODELS.LLAMA_MAVERICK, reasoning: true },
        //params: { model: COMMON_MODELS.CLAUDE_OPUS, reasoning: true },
        /*

We are testing UI. Create a document with one-shot.
Now create a document with multi-step.
Edit the document you just made and replace a line in it with the precise editing tool.
Read the documents and verify they contain what you would expect.

You were given various document editing tools. Do you feel they are understandable and robust enough to achieve all the document editing tasks your framework calls for? Assess.
                
                paramsType: AIParamsType.OpenAI,
                params: {
                    // model: 'qwen3-4b-thinking-2507-claude-4.5-opus-high-reasoning-distill-i1',
                    // model: 'qwen3-8b-claude-sonnet-4.5-reasoning-distill',
                    // model: 'qwen3-30b-a3b-thinking-2507-claude-4.5-sonnet-high-reasoning-distill',
                    model: 'qwen3-14b-claude-4.5-opus-high-reasoning-distill',
                    // model: 'Qwen3-8B-claude-sonnet-4.5-high-reasoning-distill-Q4_K_M.gguf',
                    // model: 'Qwen3-30B-A3B-Thinking-2507-Claude-4.5-Sonnet-High-Reasoning-Distill-q4_k_m.gguf',
                    baseUrl: 'http://localhost:1234/v1',
                    apiKey: 'asdf',
                    // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Use for local LM Studio or similar inference
                },*/
    },
};

// ANSI color helpers
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
    VERBOSE = 4,
}

let currentLogLevel = LogLevel.INFO;
let showReasoning = true;

function log(prefix: string, color: string, level: LogLevel, ...args: any[]) {
    if (level <= currentLogLevel) {
        console.log(`${color}[${prefix}]${c.reset}`, ...args);
    }
}

// Global context
let ctx: any;
let currentChatId: string | null = null;
let currentProjectId: string | null = null;

async function setup() {
    log('SETUP', c.blue, LogLevel.INFO, 'Initializing context...');

    ctx = await initNextjsWorkerContext({ optionalAuth: true });
    const em = ctx.em;

    const MOCK_CLERK_ID = 'user_local_dev';
    let user = await em.findOne(UserEntity, { clerkId: MOCK_CLERK_ID });
    if (!user) {
        log('SETUP', c.yellow, LogLevel.INFO, `Creating placeholder user (${MOCK_CLERK_ID})...`);
        user = em.create(UserEntity, {
            clerkId: MOCK_CLERK_ID,
            email: 'local-dev@example.com',
            emailConfirmed: true,
        });
        await em.persistAndFlush(user);
    }

    ctx.user = { userId: MOCK_CLERK_ID };

    // 2. Create/Get Project
    let project = await em.findOne(ProjectEntity, { user: user.id });
    if (!project) {
        log('SETUP', c.yellow, LogLevel.INFO, 'Creating default project...');
        project = em.create(ProjectEntity, { name: 'Local Dev Project', user });
        await em.persistAndFlush(project);
    }
    currentProjectId = project.id;

    // Get newest chat or create one
    let chat = await em.findOne(ChatEntity, { project: project.id }, { orderBy: { created_at: 'DESC' } });
    if (!chat) {
        log('SETUP', c.yellow, LogLevel.INFO, 'Creating default chat...');
        chat = em.create(ChatEntity, {
            phase: 'discovery',
            project,
            metadata: { loadedPrompts: [] },
            phase_index: 0,
        });
        await em.persistAndFlush(chat);
    }
    currentChatId = chat.id;

    log('SETUP', c.green, LogLevel.INFO, `Ready! Chat ID: ${currentChatId}`);
}

const ANSI = {
    SAVE_CURSOR: '\x1b7',
    RESTORE_CURSOR: '\x1b8',
    CLEAR_DOWN: '\x1b[J',
};

async function createNewChat(): Promise<void> {
    if (!ctx || !currentProjectId) {
        log('ERROR', c.red, LogLevel.ERROR, 'Context not initialized');
        return;
    }

    // Clear previous history
    process.stdout.write(ANSI.RESTORE_CURSOR + ANSI.CLEAR_DOWN);

    const em = ctx.em;
    const project = await em.findOneOrFail(ProjectEntity, { id: currentProjectId });
    const chat = em.create(ChatEntity, {
        phase: 'discovery',
        project,
        metadata: { loadedPrompts: [] },
        phase_index: await em.count(ChatEntity, { project: currentProjectId }),
    });
    await em.persistAndFlush(chat);
    currentChatId = chat.id;

    // Print new chat info
    console.log(`\n${c.bright}${'='.repeat(50)}${c.reset}`);
    console.log(`${c.green}New chat created: ${currentChatId}${c.reset}`);
    console.log(`${c.bright}${'='.repeat(50)}${c.reset}\n`);

    // Re-save cursor for the next session
    process.stdout.write(ANSI.SAVE_CURSOR);
}

async function nukeProject(): Promise<void> {
    if (!ctx || !currentProjectId) {
        log('ERROR', c.red, LogLevel.ERROR, 'Context not initialized');
        return;
    }

    const em = ctx.em;

    // Get all chats and artifacts in project for deletion
    const chats = await em.find(ChatEntity, { project: currentProjectId });
    const chatIds = chats.map((c: ChatEntity) => c.id);
    const artifacts = await em.find(ArtifactEntity, { project: currentProjectId });
    const artifactIds = artifacts.map((a: ArtifactEntity) => a.id);

    // Delete in correct order (respecting FK constraints)
    // 1. Null out current_version_id on artifacts (breaks FK to versions)
    if (artifactIds.length > 0) {
        await em.nativeUpdate(ArtifactEntity, { project: currentProjectId }, { current_version: null });
    }
    // 2. Delete messages (FK to chats)
    const deletedMessages =
        chatIds.length > 0 ? await em.nativeDelete(ChatMessageEntity, { chat: { $in: chatIds } }) : 0;
    // 3. Delete versions (FK to artifacts)
    const deletedVersions =
        artifactIds.length > 0 ? await em.nativeDelete(ArtifactVersionEntity, { artifact: { $in: artifactIds } }) : 0;
    // 4. Delete artifacts (FK to chats/projects)
    const deletedArtifacts = await em.nativeDelete(ArtifactEntity, { project: currentProjectId });
    // 5. Delete chats (FK to projects)
    const deletedChats = await em.nativeDelete(ChatEntity, { project: currentProjectId });

    console.log(`\n${c.red}${c.bright}🔥 NUKED PROJECT DATA:${c.reset}`);
    console.log(`${c.red}   - ${deletedChats} chat(s)${c.reset}`);
    console.log(`${c.red}   - ${deletedMessages} message(s)${c.reset}`);
    console.log(`${c.red}   - ${deletedArtifacts} artifact(s)${c.reset}`);
    console.log(`${c.red}   - ${deletedVersions} version(s)${c.reset}\n`);

    // Create a new chat since we deleted all of them
    currentChatId = null;
    await createNewChat();
}

function createEventRenderer(): { onEvent: (event: StreamEvent) => void; finalize: () => void } {
    let fullText = '';

    // === UI State ===
    const THINKING_LINES = 4;
    let statusText = 'Thinking...';
    let reasoningBuffer = '';
    let isInThinkingPhase = false;
    let thinkingHasContent = false;

    // Actions log (tools executed during thinking)
    const actions: string[] = [];

    // Document cards to show at end
    const documents: { name: string; version: number; lines?: number; action?: string }[] = [];

    // Render the collapsible thinking+actions header
    const renderThinkingHeader = () => {
        if (!showReasoning) return;

        const lines = reasoningBuffer.split('\n');
        const visibleLines = lines.length > THINKING_LINES ? lines.slice(-THINKING_LINES) : lines;

        let output = `${c.dim}┌─ ▶ Thinking + Actions ────────────────────┐${c.reset}\n`;
        output += `${c.dim}│ 💭 "${statusText}"${c.reset}\n`;

        // Show last few reasoning lines
        for (const line of visibleLines) {
            if (line.trim()) {
                const truncated = line.length > 45 ? line.substring(0, 42) + '...' : line;
                output += `${c.dim}│    ${truncated}${c.reset}\n`;
            }
        }

        // Show recent actions (max 3)
        const recentActions = actions.slice(-3);
        for (const action of recentActions) {
            output += `${c.dim}│ 🔧 ${action}${c.reset}\n`;
        }

        output += `${c.dim}└────────────────────────────────────────────┘${c.reset}`;

        logUpdate(output);
    };

    // Finalize thinking section (collapse it)
    const finalizeThinking = () => {
        if (!isInThinkingPhase) return;
        isInThinkingPhase = false;

        // Clear the updating section
        logUpdate.clear();

        // Print collapsed summary if there was content
        if (thinkingHasContent || actions.length > 0) {
            const actionCount = actions.length;
            const summary =
                actionCount > 0
                    ? `${c.dim}[▼ Thinking + ${actionCount} action${actionCount > 1 ? 's' : ''}]${c.reset}`
                    : `${c.dim}[▼ Thinking]${c.reset}`;
            console.log(summary);
        }

        reasoningBuffer = '';
        statusText = 'Thinking...';
    };

    const onEvent = (event: StreamEvent) => {
        switch (event.type) {
            case 'delta':
                finalizeThinking();
                process.stdout.write(event.text || '');
                fullText += event.text || '';
                break;

            case 'status_update':
                statusText = event.status || 'Thinking...';
                if (isInThinkingPhase) renderThinkingHeader();
                break;

            case 'reasoning_start':
                isInThinkingPhase = true;
                thinkingHasContent = false;
                reasoningBuffer = '';
                statusText = 'Thinking...';
                renderThinkingHeader();
                break;

            case 'reasoning_delta':
                if (showReasoning) {
                    isInThinkingPhase = true;
                    thinkingHasContent = true;
                    reasoningBuffer += event.text || event.content || '';
                    renderThinkingHeader();
                }
                break;

            case 'reasoning_done':
                break;

            case 'tool_start':
                actions.push(event.tool);
                if (isInThinkingPhase) {
                    renderThinkingHeader();
                } else {
                    console.log(`${c.cyan}🔧${c.reset} ${event.tool}`);
                }
                break;

            case 'tool_result':
                if (!event.success) {
                    finalizeThinking();
                    console.log(`${c.red}✗${c.reset} ${String(event.result).substring(0, 100)}`);
                } else if (currentLogLevel >= LogLevel.DEBUG) {
                    console.log(`${c.green}✓${c.reset} tool_result`);
                }
                break;

            case 'document_complete':
                documents.push({ name: event.name, version: event.version });
                break;

            case 'document_start':
            case 'document_delta':
                break;

            case 'error': {
                finalizeThinking();
                const errMsg = JSON.stringify(serializeException(event.error));
                console.log(`${c.red}[ERROR]${c.reset} ${errMsg}`);
                break;
            }

            case 'done':
            case 'done_ext':
                break;

            default:
                if (currentLogLevel >= LogLevel.VERBOSE) {
                    console.log(`${c.dim}[?] ${(event as any).type}${c.reset}`);
                }
                break;
        }
    };

    const finalize = () => {
        finalizeThinking();
        if (documents.length > 0) {
            console.log('');
            for (const doc of documents) {
                console.log(`${c.cyan}📄 ${doc.name}${c.reset} ${c.dim}v${doc.version}${c.reset}`);
            }
        }
    };

    return { onEvent, finalize };
}

async function handleMessage(message: string): Promise<void> {
    if (!ctx || !currentChatId) {
        log('ERROR', c.red, LogLevel.ERROR, 'Context not initialized');
        return;
    }

    log('AGENT', c.blue, LogLevel.INFO, 'Sending message...');

    try {
        const renderer = createEventRenderer();
        const result = await chatActionHandler({ chatId: currentChatId, message }, ctx, {
            ...overrideOpts,
            onEvent: renderer.onEvent,
        });
        console.log(`${c.green}--- Assistant ---${c.reset}`);
        await result.generation;
        renderer.finalize();
        console.log(`\n${c.dim}-----------------${c.reset}`);
    } catch (error) {
        log('ERROR', c.red, LogLevel.ERROR, 'Handler failed:', error);
    }
}

// Wrap execution in async main IIFE to avoid top-level await issues
(async () => {
    try {
        await setup();

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        console.log(`${c.bright}Chat Handler Test Harness (runnor)${c.reset}`);
        console.log(
            `Commands: ${c.cyan}/quit${c.reset}, ${c.cyan}/new${c.reset}, ${c.cyan}/debug [level]${c.reset}, ${c.cyan}/reasoning${c.reset}\n`,
        );

        // Save cursor position before starting the prompt loop
        process.stdout.write(ANSI.SAVE_CURSOR);

        const prompt = () => {
            rl.question(`${c.bright}You:${c.reset} `, async (input) => {
                const trimmed = input.trim();

                if (!trimmed) {
                    prompt();
                    return;
                }

                if (trimmed.startsWith('/')) {
                    const parts = trimmed.split(' ');
                    const cmd = parts[0].toLowerCase();

                    if (['/quit', '/exit', '/q'].includes(cmd)) {
                        console.log('Bye!');
                        rl.close();
                        process.exit(0);
                    } else if (cmd === '/debug') {
                        const levelStr = (parts[1] || '').toUpperCase();
                        if (levelStr in LogLevel && isNaN(Number(levelStr))) {
                            currentLogLevel = (LogLevel as any)[levelStr];
                            console.log(`${c.green}Log level set to: ${c.bright}${levelStr}${c.reset}`);
                        } else {
                            console.log(`${c.yellow}Usage: /debug [ERROR|WARN|INFO|DEBUG|VERBOSE]${c.reset}`);
                            console.log(`${c.dim}Current level: ${LogLevel[currentLogLevel]}${c.reset}`);
                        }
                    } else if (cmd === '/reasoning') {
                        showReasoning = !showReasoning;
                        console.log(`${c.green}Show reasoning: ${c.bright}${showReasoning}${c.reset}`);
                    } else if (cmd === '/new') {
                        await createNewChat();
                    } else if (cmd === '/nuke') {
                        await nukeProject();
                    } else {
                        console.log('Unknown command');
                    }

                    prompt();
                    return;
                }

                await handleMessage(trimmed);
                console.log('');
                prompt();
            });
        };

        prompt();
    } catch (err) {
        console.error(err);
    }
})();
