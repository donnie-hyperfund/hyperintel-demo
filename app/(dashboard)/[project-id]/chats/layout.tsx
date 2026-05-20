import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getProjectPageData } from '@/lib/api/server/page-data';
import { formatProjectPhasesTitle } from '@/lib/metadata/page-title';

type ProjectChatsLayoutProps = {
    children: ReactNode;
    params: Promise<{ 'project-id': string }>;
};

export async function generateMetadata({ params }: ProjectChatsLayoutProps): Promise<Metadata> {
    const { 'project-id': projectId } = await params;
    const { project } = await getProjectPageData(projectId);

    if (!project) return {};

    return {
        title: formatProjectPhasesTitle(project.name),
    };
}

export default function ProjectChatsLayout({ children }: ProjectChatsLayoutProps) {
    return children;
}
