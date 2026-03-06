import { DashboardLayout } from '@/components/layouts/dashboard-layout';

// import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';

type DashboardLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: DashboardLayoutProps) {
    return (
        <DashboardLayout>
            {/* <ModelSelectionProvider>{children}</ModelSelectionProvider> */} {/* NOTE: Hidden temporarily */}
            {children}
        </DashboardLayout>
    );
}
