import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Add to Project Intel',
};

type ProjectResourcesLayoutProps = LayoutProps<'/projects/new/resources'>;

export default function ProjectResourcesLayout({ children }: ProjectResourcesLayoutProps) {
    return children;
}
