import type { Metadata } from 'next';
import type { ChatDto } from '@/lib/schema/message';

export const APP_TITLE = 'HYPERINTEL™';

type MetadataTitle = NonNullable<Metadata['title']>;

export function formatPageTitle(context: string): MetadataTitle {
    return {
        absolute: `${context} | ${APP_TITLE}`,
    };
}

export function formatPhaseTitle(projectName: string, chat: Pick<ChatDto, 'name' | 'phase_index'>): MetadataTitle {
    const phaseLabel = chat.name?.trim() || `Phase ${chat.phase_index + 1}`;
    return formatPageTitle(`${projectName} · ${phaseLabel}`);
}

export function formatNewPhaseTitle(projectName: string): MetadataTitle {
    return formatPageTitle(`${projectName} · New phase`);
}

export function formatProjectPhasesTitle(projectName: string): MetadataTitle {
    return formatPageTitle(`${projectName} · Phases`);
}
