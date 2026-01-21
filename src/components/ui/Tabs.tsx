'use client';

import { ReactNode, useState, useEffect, memo } from 'react';
import { useAppStore } from '@/store/app-store';

interface Tab {
  id: string;
  label: string;
  /**
   * Render function for lazy tab content. The function is only called when
   * the tab becomes active, preventing expensive renders for hidden tabs.
   */
  render: () => ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

// Memoized tab content wrapper to prevent unnecessary re-renders
const TabContent = memo(function TabContent({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
});

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const { activeTab: globalActiveTab, setActiveTab: setGlobalActiveTab } = useAppStore();
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

  // Sync with global activeTab when it changes (for search navigation)
  useEffect(() => {
    if (globalActiveTab && tabs.some(tab => tab.id === globalActiveTab)) {
      setActiveTab(globalActiveTab);
      setGlobalActiveTab(null);
    }
  }, [globalActiveTab, tabs, setGlobalActiveTab]);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
  };

  const activeTabData = tabs.find((tab) => tab.id === activeTab);

  return (
    <div>
      {/* Tab Headers - scrollable on mobile */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div className="flex gap-1 border-b border-[var(--border)] mb-4 md:mb-6 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`px-3 md:px-4 py-2 md:py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content - only renders active tab, calls render() lazily */}
      <div>
        {activeTabData && <TabContent key={activeTab} render={activeTabData.render} />}
      </div>
    </div>
  );
}
