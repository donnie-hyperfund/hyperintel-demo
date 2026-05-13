import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Company profiles',
};

type CompaniesLayoutProps = LayoutProps<'/companies'>;

export default function CompaniesLayout({ children }: CompaniesLayoutProps) {
    return children;
}
