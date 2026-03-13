'use client';

import { RecentProjectsSection } from './_components/recent-projects-section';
import { StartOptionsGrid } from './_components/start-options-grid';
import { WorkspaceHero } from './_components/workspace-hero';

export default function WorkspacePage() {
    return (
        <div className="mx-auto w-full max-w-6xl">
            <WorkspaceHero />
            <StartOptionsGrid />
            <RecentProjectsSection />
        </div>
    );
}
