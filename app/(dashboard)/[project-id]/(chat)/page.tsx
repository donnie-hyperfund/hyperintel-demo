import type { Metadata } from 'next';
import { getProjectPageData } from '@/lib/api/server/page-data';
import { formatNewPhaseTitle, formatPageTitle } from '@/lib/metadata/page-title';

type ChatPageParams = PageProps<'/[project-id]'>;

export async function generateMetadata({ params, searchParams }: ChatPageParams): Promise<Metadata> {
    const { 'project-id': projectId } = await params;
    const sp = await searchParams;
    const { project } = await getProjectPageData(projectId);

    if (!project) return {};

    return {
        title: sp.new ? formatNewPhaseTitle(project.name) : formatPageTitle(project.name),
    };
}

// Bare /[project-id] is redirected by middleware. This page only renders for ?new=true.
export default async function ChatPage({ params }: ChatPageParams) {
    await params;
    return null;
}
