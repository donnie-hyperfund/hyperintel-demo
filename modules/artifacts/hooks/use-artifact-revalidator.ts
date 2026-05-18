'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { artifactKeys, createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { createProjectArtifactApi, serializeProjectArtifactListKey } from '@/lib/api/client/fetchers/project-artifacts';
import {
    type ArtifactScope,
    getArtifactScopeForProject,
    useArtifactStoreController,
} from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';

type RevalidateArtifactInput = {
    artifactId?: string;
    artifactKey: string;
    version: number;
    projectId?: string | null;
    scope?: ArtifactScope;
};

export function useArtifactRevalidator() {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const artifactStore = useArtifactStoreController();

    return useCallback(
        async ({ artifactId, artifactKey, version, projectId, scope }: RevalidateArtifactInput) => {
            const targetScope = scope ?? getArtifactScopeForProject(projectId);

            if (projectId) {
                void globalMutate(serializeProjectArtifactListKey(projectId));
            } else {
                void globalMutate((key) => Array.isArray(key) && key[0] === artifactKeys.all[0]);
            }

            const fetcher = projectId
                ? (artifactVersion: number) =>
                      createProjectArtifactApi(getToken).getByKey(projectId, artifactKey, artifactVersion)
                : (artifactVersion: number) => createArtifactApi(getToken).getByKey(artifactKey, artifactVersion);

            const slots = artifactId ? (artifactStore.getStore(targetScope)[artifactId] ?? {}) : {};
            const stalePrevProposedVersions = Object.entries(slots)
                .map(([slot, data]) => [Number(slot), data] as const)
                .filter(([slot, data]) => slot !== version && getLatestArtifactVersion(data)?.status === 'proposed')
                .map(([slot]) => slot);

            const targets = [...new Set([version, ...stalePrevProposedVersions])];
            const results = await Promise.all(targets.map((targetVersion) => fetcher(targetVersion).catch(() => null)));

            for (const data of results) {
                if (!data) continue;
                const versionNumber = getLatestArtifactVersion(data)?.version;
                if (typeof versionNumber !== 'number') continue;

                const normalized = { ...data, id: data.id, key: data.key || artifactKey };
                if (artifactStore.getArtifact(targetScope, data.id, versionNumber)) {
                    artifactStore.updateArtifact(targetScope, data.id, normalized, versionNumber, { merge: false });
                } else {
                    artifactStore.addArtifact(targetScope, normalized, versionNumber);
                }
            }
        },
        [artifactStore, getToken, globalMutate],
    );
}
