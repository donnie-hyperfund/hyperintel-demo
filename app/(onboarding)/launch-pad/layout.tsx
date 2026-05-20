import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Launch Pad',
};

type LaunchPadLayoutProps = LayoutProps<'/launch-pad'>;

export default function Layout({ children }: LaunchPadLayoutProps) {
    return (
        <>
            <style>{`body { background-color: #0a0a0a; }`}</style>
            {children}
        </>
    );
}
