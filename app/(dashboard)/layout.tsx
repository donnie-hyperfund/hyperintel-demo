import { DashboardLayout } from '@/components/layouts/dashboard-layout';

type DashboardLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: DashboardLayoutProps) {
    return <DashboardLayout>{children}</DashboardLayout>;
}
