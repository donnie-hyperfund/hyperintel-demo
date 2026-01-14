import { DashboardLayout } from '@/components/layouts/dashboard-layout';

type LayoutProps = {
    children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
    return <DashboardLayout>{children}</DashboardLayout>;
}
