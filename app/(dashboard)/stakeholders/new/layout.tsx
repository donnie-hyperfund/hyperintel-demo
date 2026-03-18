import { Suspense } from 'react';

type NewStakeholderLayoutProps = LayoutProps<'/stakeholders/new'>;

export default function NewStakeholderLayout({ children }: NewStakeholderLayoutProps) {
    return <Suspense>{children}</Suspense>;
}
