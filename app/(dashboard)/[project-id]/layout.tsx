import { SWRConfig, unstable_serialize } from 'swr';
import { assertAuthPage } from '@/lib/api/auth-guard';
import { projectKeys } from '@/lib/api/client/fetchers/projects';
import { fetchProject } from '@/lib/api/server/fetchers/projects';
import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';

interface ProjectLayoutProps {
    children: React.ReactNode;
    params: Promise<{ 'project-id': string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
    const { 'project-id': projectId } = await params;
    const user = await assertAuthPage();

    const [project] = await Promise.all([fetchProject(projectId, user)]);

    const fallback: Record<string, unknown> = {};

    if (project) {
        fallback[unstable_serialize(projectKeys.detail(projectId))] = project;
    }

    return (
        <SWRConfig value={{ fallback }}>
            <ModelSelectionProvider>{children}</ModelSelectionProvider>
        </SWRConfig>
    );
}
