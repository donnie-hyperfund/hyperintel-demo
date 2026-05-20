import camelcaseKeys from 'camelcase-keys';
import type { Metadata } from 'next';
import { SWRConfig } from 'swr';
import { unstable_serialize } from 'swr/infinite';
import { assertAuthPage } from '@/lib/api/auth-guard';
import { getResourceListInfiniteKey } from '@/lib/api/client/fetchers/resources';
import { fetchResources } from '@/lib/api/server/fetchers/resources';
import { ProjectCreationWizardProvider } from './_providers/project-creation-wizard-provider';

export const metadata: Metadata = {
    title: 'Create a new project',
};

type NewProjectLayoutProps = LayoutProps<'/projects/new'>;

export default async function NewProjectLayout({ children }: NewProjectLayoutProps) {
    const user = await assertAuthPage();
    const resources = await fetchResources(user, { page: 1, limit: 20 });

    const fallback: Record<string, unknown> = {
        [unstable_serialize(getResourceListInfiniteKey({ limit: 20 }))]: [camelcaseKeys(resources, { deep: true })],
    };

    return (
        <SWRConfig value={{ fallback }}>
            <ProjectCreationWizardProvider>{children}</ProjectCreationWizardProvider>
        </SWRConfig>
    );
}
