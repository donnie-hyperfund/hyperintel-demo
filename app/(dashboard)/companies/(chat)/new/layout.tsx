import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'New company',
};

type NewCompanyLayoutProps = LayoutProps<'/companies/new'>;

export default function NewCompanyLayout({ children }: NewCompanyLayoutProps) {
    return children;
}
