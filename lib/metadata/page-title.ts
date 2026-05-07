import type { ChatDto } from '@/lib/schema/message';

export function formatPhaseTitle(projectName: string, chat: Pick<ChatDto, 'name' | 'phase_index'>): string {
    const phaseLabel = chat.name?.trim() || `Phase ${chat.phase_index + 1}`;
    return `${phaseLabel} · ${projectName}`;
}

export function formatNewPhaseTitle(projectName: string): string {
    return `New phase · ${projectName}`;
}

export function formatProjectPhasesTitle(projectName: string): string {
    return `Phases · ${projectName}`;
}
