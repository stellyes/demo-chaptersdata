'use client';

import { useState, useMemo } from 'react';
import { useAppStore, useAutoLoadData, useReloadCustomersOnDateChange } from '@/store/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { DashboardPage } from '@/components/pages/DashboardPage';
import { SalesAnalyticsPage } from '@/components/pages/SalesAnalyticsPage';
import { RecommendationsPage } from '@/components/pages/RecommendationsPage';
import { DataCenterPage } from '@/components/pages/DataCenterPage';
import { MarketingAnalyticsPage } from '@/components/pages/MarketingAnalyticsPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { CompliancePage } from '@/components/pages/CompliancePage';
import { LoginPage } from '@/components/pages/LoginPage';
import { LoadingToast } from '@/components/ui/LoadingToast';
import { NotificationCenter } from '@/components/ui/NotificationCenter';
import { GuestEmailCapture } from '@/components/ui/GuestEmailCapture';
import { Menu, Bell } from 'lucide-react';

export default function AppClient() {
  const { user, currentPage, isLoading, dataStatus, toggleSidebar, notifications, dismissedNotificationIds, currentOrganization } = useAppStore();
  const [mobileNotificationOpen, setMobileNotificationOpen] = useState(false);

  // Count unread notifications for mobile badge
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !dismissedNotificationIds.includes(n.id)).length;
  }, [notifications, dismissedNotificationIds]);

  // Show loading toast when main data is loading OR when background data is still loading
  const isDataLoading = isLoading || (dataStatus.sales.loaded && !dataStatus.research.loaded);

  // Auto-load data from Aurora when user is present
  useAutoLoadData();

  // Reload customer data when date range changes
  useReloadCustomersOnDateChange();

  // Show guest landing if no user in store
  if (!user) {
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'sales':
        return <SalesAnalyticsPage />;
      case 'recommendations':
        return <RecommendationsPage />;
      case 'marketing':
        return <MarketingAnalyticsPage />;
      case 'data-center':
        return <DataCenterPage />;
      case 'compliance':
        return <CompliancePage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex min-h-screen font-sans bg-[var(--paper)] text-[var(--ink)]">
      {/* Noise Overlay */}
      <div className="noise-overlay"></div>

      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <header className="lg:hidden sticky top-0 z-30 bg-[var(--paper)] border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg hover:bg-[var(--accent)]/10 transition-colors"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-6 h-6 text-[var(--ink)]" />
            </button>
            <h1 className="font-serif text-lg font-semibold text-[var(--ink)] tracking-tight">
              {currentOrganization?.name || 'Dashboard'}
            </h1>
          </div>
          {/* Mobile Notification Bell */}
          <div className="relative">
            <button
              onClick={() => setMobileNotificationOpen(!mobileNotificationOpen)}
              className="relative p-2 rounded-lg hover:bg-[var(--accent)]/10 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-6 h-6 text-[var(--ink)]" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--accent)] text-white text-xs font-medium rounded-full px-1">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <NotificationCenter
              isOpen={mobileNotificationOpen}
              onClose={() => setMobileNotificationOpen(false)}
            />
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 md:p-6 lg:p-8">
          {renderPage()}
        </div>
      </main>

      {/* Loading Toast - shows after 500ms if data is still loading */}
      <LoadingToast isVisible={isDataLoading} delayMs={500} />

      {/* Soft email capture — appears after 30s, non-blocking */}
      <GuestEmailCapture />
    </div>
  );
}
