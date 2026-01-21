'use client';

import { ArtifactList } from './_components/artifact-list';

export default function ArtifactsPage() {
    return (
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-12">
            <div className="mb-8 flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Your artifacts</h1>
            </div>

            <ArtifactList />
        </div>
    );
}
