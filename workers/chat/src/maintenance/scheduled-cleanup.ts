import { initInferredContext } from '@/workers/_common/context.helpers';
import { cleanupReservedArtifacts, type ReservedArtifactCleanupResult } from '../artifacts/reserved-artifact-cleanup';
import { cleanupStaleUploads, type UploadCleanupResult } from '../uploads/cleanup';
import { createStaleCleanupCutoff } from './cleanup-policy';

export type ScheduledCleanupResult = {
    artifacts: ReservedArtifactCleanupResult;
    uploads: UploadCleanupResult;
};

function hasScheduledCleanupWork(result: ScheduledCleanupResult): boolean {
    return (
        result.artifacts.reservedArtifacts > 0 ||
        result.uploads.staleArtifactUploads > 0 ||
        result.uploads.abandonedStagedArtifacts > 0 ||
        result.uploads.staleImageUploads > 0
    );
}

function logScheduledCleanupResult(result: ScheduledCleanupResult): void {
    if (!hasScheduledCleanupWork(result)) return;
    console.log(
        `[cleanup] Removed ${result.artifacts.reservedArtifacts} reserved orphan artifacts, ` +
            `${result.uploads.staleArtifactUploads} stale artifact uploads, ` +
            `${result.uploads.abandonedStagedArtifacts} abandoned staged artifacts, ` +
            `${result.uploads.staleImageUploads} stale image uploads`,
    );
}

export async function runScheduledCleanup(env: ChatEnv): Promise<ScheduledCleanupResult> {
    const ctx = await initInferredContext(env, {}, { withOrm: true });
    const cutoff = createStaleCleanupCutoff();

    const result: ScheduledCleanupResult = {
        artifacts: await cleanupReservedArtifacts({ em: ctx.em, cutoff }),
        uploads: await cleanupStaleUploads({ em: ctx.em, env, cutoff }),
    };

    logScheduledCleanupResult(result);
    return result;
}
