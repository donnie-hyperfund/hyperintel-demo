'use client';

import { ArtifactList } from './_components/artifact-list';

export default function ArtifactsPage() {
    return (
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden px-4 py-12">
            <div className="mb-8 flex shrink-0 items-center justify-between">
                <h1 className="text-2xl font-semibold">Your artifacts</h1>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <ArtifactList />
            </div>
        </div>
    );
}
