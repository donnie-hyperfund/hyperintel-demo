import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ArtifactDto } from '@/lib/schema/artifact';
import type { FileEntry } from '../types';

export type ResourceListItem =
    | { kind: 'upload'; entry: FileEntry }
    | { kind: 'artifact'; artifact: CamelCaseDto<ArtifactDto> };

/** Merge-sorts upload placeholders and API artifacts into a single newest-first list. */
export function mergeByDate(uploads: FileEntry[], artifacts: CamelCaseDto<ArtifactDto>[]): ResourceListItem[] {
    const merged: ResourceListItem[] = [];
    let ui = 0;
    let ai = 0;

    while (ui < uploads.length && ai < artifacts.length) {
        if (uploads[ui].createdAt >= new Date(artifacts[ai].createdAt).getTime()) {
            merged.push({ kind: 'upload', entry: uploads[ui++] });
        } else {
            merged.push({ kind: 'artifact', artifact: artifacts[ai++] });
        }
    }

    while (ui < uploads.length) merged.push({ kind: 'upload', entry: uploads[ui++] });
    while (ai < artifacts.length) merged.push({ kind: 'artifact', artifact: artifacts[ai++] });

    return merged;
}
