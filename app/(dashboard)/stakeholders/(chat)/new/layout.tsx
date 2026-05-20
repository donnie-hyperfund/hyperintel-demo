import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'New stakeholder',
};

type NewStakeholderLayoutProps = LayoutProps<'/stakeholders/new'>;

export default function NewStakeholderLayout({ children }: NewStakeholderLayoutProps) {
    return children;
}
