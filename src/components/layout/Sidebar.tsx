'use client';

import {
  Activity,
  LayoutDashboard,
  TrendingUp,
  Sparkles,
  Database,
  FileText,
  Search,
  FileBox,
  QrCode,
  Settings,
  LogOut,
  Moon,
  Sun,
  Store,
  RefreshCw,
  Cloud,
  Loader2,
} from 'lucide-react';
import { useAppStore, PageType } from '@/store/app-store';
import { STORES } from '@/lib/config';
import { StoreId } from '@/types';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  page: PageType;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded border-none cursor-pointer transition-all duration-200 font-sans text-sm font-medium text-left ${
        active
          ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'bg-transparent text-[var(--muted)] hover:bg-[var(--accent)]/5'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </button>
  );
}

export function Sidebar() {
  const {
    user,
    currentPage,
    setCurrentPage,
    selectedStore,
    setSelectedStore,
    darkMode,
    toggleDarkMode,
    setUser,
    loadDataFromS3,
    isLoading,
    dataStatus,
  } = useAppStore();

  const handleLogout = () => {
    fetch('/api/auth', { method: 'DELETE' });
    setUser(null);
  };

  const handleRefreshData = () => {
    loadDataFromS3();
  };

  // Main navigation - matches Streamlit app structure
  // Research, SEO, Invoices, and QR are sub-tabs within Data Center
  const navItems: { icon: React.ElementType; label: string; page: PageType }[] = [
    { icon: LayoutDashboard, label: 'Dashboard', page: 'dashboard' },
    { icon: TrendingUp, label: 'Sales Analytics', page: 'sales' },
    { icon: Sparkles, label: 'Recommendations', page: 'recommendations' },
    { icon: Database, label: 'Data Center', page: 'data-center' },
  ];

  return (
    <div className="w-64 bg-[var(--paper)] border-r border-[var(--border)] p-6 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <div className="w-10 h-10 rounded bg-[var(--accent)] flex items-center justify-center">
          <Activity className="w-6 h-6 text-[var(--paper)]" />
        </div>
        <div>
          <h1 className="font-serif text-xl font-semibold text-[var(--ink)] tracking-tight m-0">
            Chapters
          </h1>
          <p className="text-[0.7rem] text-[var(--muted)] m-0">Analytics Dashboard</p>
        </div>
      </div>

      {/* Store Selector */}
      <div className="mb-6 shrink-0">
        <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-2 block">
          Store
        </label>
        <div className="relative">
          <Store className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value as StoreId)}
            className="w-full pl-10 pr-4 py-2 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--ink)] text-sm font-sans appearance-none cursor-pointer"
          >
            {Object.values(STORES).map((store) => (
              <option key={store.id} value={store.id}>
                {store.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => (
          <NavItem
            key={item.page}
            icon={item.icon}
            label={item.label}
            page={item.page}
            active={currentPage === item.page}
            onClick={() => setCurrentPage(item.page)}
          />
        ))}
      </nav>

      {/* Bottom section - fixed to bottom */}
      <div className="mt-auto shrink-0">
        {/* Data Status & Refresh */}
        <div className="mb-4 p-3 bg-[var(--accent)]/5 rounded">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-xs font-medium text-[var(--accent)]">Data Status</span>
            </div>
            <button
              onClick={handleRefreshData}
              disabled={isLoading}
              className="p-1 rounded hover:bg-[var(--accent)]/10 disabled:opacity-50"
              title="Refresh data from S3"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 text-[var(--accent)]" />
              )}
            </button>
          </div>
          <div className="text-xs text-[var(--muted)] space-y-0.5 max-h-36 overflow-y-auto">
            <div className="flex justify-between">
              <span>Sales:</span>
              <span className={dataStatus.sales.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.sales.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Brands:</span>
              <span className={dataStatus.brands.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.brands.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Products:</span>
              <span className={dataStatus.products.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.products.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Customers:</span>
              <span className={dataStatus.customers.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.customers.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Budtenders:</span>
              <span className={dataStatus.budtenders.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.budtenders.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Mappings:</span>
              <span className={dataStatus.mappings.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.mappings.count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Invoices:</span>
              <span className={dataStatus.invoices.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                {dataStatus.invoices.count.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-3 px-4 py-3 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--muted)] text-sm font-medium cursor-pointer mb-4 hover:bg-[var(--cream)] transition-colors"
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* User section */}
        <div className="pt-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-white font-semibold text-sm">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--ink)] m-0 capitalize">
                {user?.username || 'Guest'}
              </p>
              <p className="text-xs text-[var(--muted)] m-0 capitalize">{user?.role || 'User'}</p>
            </div>
            <Settings className="w-5 h-5 text-[var(--muted)] cursor-pointer" />
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--muted)] text-sm font-medium cursor-pointer hover:bg-[var(--cream)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
