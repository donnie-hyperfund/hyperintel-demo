import { useCallback, useState } from 'react';
import { RESOURCE_TABS, type ResourceTab } from '../resource-tabs';

export function useResourceTabs(tabs: ResourceTab[] = RESOURCE_TABS) {
    const [activeTab, setActiveTab] = useState(tabs[0].value);
    const activeTabConfig = tabs.find((t) => t.value === activeTab) ?? tabs[0];
    const reset = useCallback(() => setActiveTab(tabs[0].value), [tabs]);
    return { tabs, activeTab, setActiveTab, activeTabConfig, reset };
}
