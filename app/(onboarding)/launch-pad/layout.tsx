import type { Metadata } from 'next';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Launch Pad'),
};

type LayoutProps = {
    children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
    return (
        <>
            <style>{`body { background-color: #0a0a0a; }`}</style>
            {children}
        </>
    );
}
