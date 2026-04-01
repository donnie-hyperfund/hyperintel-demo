import camelcaseKeys from 'camelcase-keys';
import { SWRConfig, unstable_serialize } from 'swr';
import { assertAuthPage } from '@/lib/api/auth-guard';
import { projectKeys } from '@/lib/api/client/fetchers/projects';
import { fetchProject } from '@/lib/api/server/fetchers/projects';

type ProjectLayoutProps = LayoutProps<'/[project-id]'>;

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
    const { 'project-id': projectId } = await params;
    const user = await assertAuthPage();

    const [project] = await Promise.all([fetchProject(projectId, user)]);
    if (!project) notFound();

    const fallback: Record<string, unknown> = {};

    if (project) {
        fallback[unstable_serialize(projectKeys.detail(projectId))] = camelcaseKeys(project, { deep: true });
    }

    return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
