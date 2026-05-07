import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Launch Pad',
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
