export function getPreviousArtifactVersion(version: number): number | undefined {
    return version > 1 ? version - 1 : undefined;
}
