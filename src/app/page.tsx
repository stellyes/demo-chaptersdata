'use client';

import { useAppStore, useAutoLoadData } from '@/store/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { DashboardPage } from '@/components/pages/DashboardPage';
import { SalesAnalyticsPage } from '@/components/pages/SalesAnalyticsPage';
import { RecommendationsPage } from '@/components/pages/RecommendationsPage';
import { DataCenterPage } from '@/components/pages/DataCenterPage';
import { LoginPage } from '@/components/pages/LoginPage';
import { LoadingToast } from '@/components/ui/LoadingToast';
import { Menu, Activity } from 'lucide-react';

export default function App() {
  const { user, currentPage, isLoading, dataStatus, toggleSidebar } = useAppStore();

  // Show loading toast when main data is loading OR when invoices are still loading
  const isDataLoading = isLoading || (dataStatus.sales.loaded && !dataStatus.invoices.loaded);

  // Auto-load data from S3 when user is logged in
  useAutoLoadData();

  // Show login if not authenticated
  if (!user) {
    return <LoginPage />;
  }

  // Main 4 pages - matches Streamlit app structure
  // Other pages (Research, SEO, Invoices, QR) are tabs within Data Center
  const renderPage = () => {
    switch (currentPage) {
      case 'sales':
        return <SalesAnalyticsPage />;
      case 'recommendations':
        return <RecommendationsPage />;
      case 'data-center':
        return <DataCenterPage />;
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
        <header className="lg:hidden sticky top-0 z-30 bg-[var(--paper)] border-b border-[var(--border)] px-4 py-3 flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-[var(--accent)]/10 transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-6 h-6 text-[var(--ink)]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[var(--accent)] flex items-center justify-center">
              <Activity className="w-5 h-5 text-[var(--paper)]" />
            </div>
            <h1 className="font-serif text-lg font-semibold text-[var(--ink)] tracking-tight">
              Chapters
            </h1>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 md:p-6 lg:p-8">
          {renderPage()}
        </div>
      </main>

      {/* Loading Toast - mirrors Streamlit loading screen */}
      <LoadingToast isVisible={isDataLoading} dataStatus={dataStatus} />
    </div>
  );
}
