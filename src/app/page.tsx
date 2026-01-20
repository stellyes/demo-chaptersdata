'use client';

import { useAppStore, useAutoLoadData } from '@/store/app-store';
import { Sidebar } from '@/components/layout/Sidebar';
import { DashboardPage } from '@/components/pages/DashboardPage';
import { SalesAnalyticsPage } from '@/components/pages/SalesAnalyticsPage';
import { RecommendationsPage } from '@/components/pages/RecommendationsPage';
import { DataCenterPage } from '@/components/pages/DataCenterPage';
import { LoginPage } from '@/components/pages/LoginPage';
import { LoadingToast } from '@/components/ui/LoadingToast';

export default function App() {
  const { user, currentPage, isLoading, dataStatus } = useAppStore();

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
      <main className="flex-1 p-8 overflow-y-auto">
        {renderPage()}
      </main>

      {/* Loading Toast - mirrors Streamlit loading screen */}
      <LoadingToast isVisible={isDataLoading} dataStatus={dataStatus} />
    </div>
  );
}
