import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Projects',
};

type ProjectsLayoutProps = LayoutProps<'/projects'>;

export default function ProjectsLayout({ children }: ProjectsLayoutProps) {
    return children;
}
