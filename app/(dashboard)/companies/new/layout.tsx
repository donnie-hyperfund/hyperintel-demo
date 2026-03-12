import { Suspense } from 'react';

type NewCompanyLayoutProps = LayoutProps<'/companies/new'>;

export default function NewCompanyLayout({ children }: NewCompanyLayoutProps) {
    return <Suspense>{children}</Suspense>;
}
