import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Stakeholder personas',
};

type StakeholdersLayoutProps = LayoutProps<'/stakeholders'>;

export default function StakeholdersLayout({ children }: StakeholdersLayoutProps) {
    return children;
}
