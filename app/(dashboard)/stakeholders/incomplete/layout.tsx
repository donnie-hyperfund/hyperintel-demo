import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Incomplete stakeholder conversations',
};

type StakeholdersIncompleteLayoutProps = LayoutProps<'/stakeholders/incomplete'>;

export default function StakeholdersIncompleteLayout({ children }: StakeholdersIncompleteLayoutProps) {
    return children;
}
