import camelcaseKeys from 'camelcase-keys';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SWRConfig, unstable_serialize } from 'swr';
import { projectKeys } from '@/lib/api/client/fetchers/projects';
import { getProjectPageData } from '@/lib/api/server/page-data';
import { formatPageTitle } from '@/lib/metadata/page-title';

type ProjectLayoutProps = LayoutProps<'/[project-id]'>;

export async function generateMetadata({ params }: ProjectLayoutProps): Promise<Metadata> {
    const { 'project-id': projectId } = await params;
    const { project } = await getProjectPageData(projectId);

    if (!project) return {};

    return {
        title: formatPageTitle(project.name),
    };
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
    const { 'project-id': projectId } = await params;
    const { project } = await getProjectPageData(projectId);
    if (!project) notFound();

    const fallback: Record<string, unknown> = {
        [unstable_serialize(projectKeys.detail(projectId))]: camelcaseKeys(project, { deep: true }),
    };

    return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
