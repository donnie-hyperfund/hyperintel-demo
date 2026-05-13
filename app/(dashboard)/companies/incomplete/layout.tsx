import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Incomplete company conversations',
};

type CompaniesIncompleteLayoutProps = LayoutProps<'/companies/incomplete'>;

export default function CompaniesIncompleteLayout({ children }: CompaniesIncompleteLayoutProps) {
    return children;
}
