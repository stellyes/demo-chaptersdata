'use client';

import {
  LayoutDashboard,
  TrendingUp,
  Sparkles,
  Database,
  QrCode,
  Settings,
  LogOut,
  Moon,
  Sun,
  Store,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useAppStore, PageType } from '@/store/app-store';
import { STORES } from '@/lib/config';
import { StoreId } from '@/types';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDisplayName } from '@/hooks/useDisplayName';

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
      className={`w-full flex items-center gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded border-none cursor-pointer transition-all duration-200 font-sans text-sm font-medium text-left ${
        active
          ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'bg-transparent text-[var(--muted)] hover:bg-[var(--accent)]/5'
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
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
    sidebarOpen,
    setSidebarOpen,
    setCurrentOrganization,
  } = useAppStore();

  const { signOut } = useAuth();
  const { displayName } = useDisplayName(user?.userId);

  const handleLogout = async () => {
    await signOut();
    setUser(null);
    setCurrentOrganization(null);
  };

  const handleNavClick = (page: PageType) => {
    setCurrentPage(page);
    // Close sidebar on mobile after navigation
    setSidebarOpen(false);
  };

  // Close sidebar when pressing Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen, setSidebarOpen]);

  // Main navigation
  const navItems: { icon: React.ElementType; label: string; page: PageType }[] = [
    { icon: LayoutDashboard, label: 'Dashboard', page: 'dashboard' },
    { icon: TrendingUp, label: 'Sales Analytics', page: 'sales' },
    { icon: Sparkles, label: 'Recommendations', page: 'recommendations' },
    { icon: Database, label: 'Data Center', page: 'data-center' },
    { icon: QrCode, label: 'QR Codes', page: 'qr-codes' },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`
          fixed lg:sticky top-0 left-0 z-50
          w-72 lg:w-64 bg-[var(--paper)] border-r border-[var(--border)] p-4 sm:p-6 flex flex-col h-screen max-h-screen overflow-y-auto
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--accent)]/10 lg:hidden"
        >
          <X className="w-5 h-5 text-[var(--muted)]" />
        </button>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6 shrink-0">
        <Image
          src="/chapters-logo.svg"
          alt="Chapters Logo"
          width={40}
          height={40}
          className="w-8 h-8 sm:w-10 sm:h-10 logo-dark-invert"
        />
        <div>
          <h1 className="font-serif text-lg sm:text-xl font-semibold text-[var(--ink)] tracking-tight m-0 leading-none">
            Chapters
          </h1>
          <p className="text-[0.5rem] sm:text-[0.55rem] text-[var(--muted)] m-0 mt-0.5 leading-none">Data & Marketing Consulting, LLC</p>
        </div>
      </div>

      {/* Store Selector */}
      <div className="mb-4 sm:mb-6 shrink-0">
        <label className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5 sm:mb-2 block">
          Store
        </label>
        <div className="relative">
          <Store className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value as StoreId)}
            className="w-full pl-10 pr-4 py-1.5 sm:py-2 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--ink)] text-sm font-sans appearance-none cursor-pointer"
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
            onClick={() => handleNavClick(item.page)}
          />
        ))}
      </nav>

      {/* Bottom section - fixed to bottom */}
      <div className="mt-auto shrink-0 pt-2">
        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="w-full flex items-center gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--muted)] text-sm font-medium cursor-pointer mb-3 sm:mb-4 hover:bg-[var(--cream)] transition-colors"
        >
          {darkMode ? <Sun className="w-5 h-5 shrink-0" /> : <Moon className="w-5 h-5 shrink-0" />}
          <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* User section */}
        <div className="pt-3 sm:pt-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-white font-semibold text-xs sm:text-sm shrink-0">
              {(displayName || user?.username)?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--ink)] m-0 truncate">
                {displayName || user?.username || 'Guest'}
              </p>
              <p className="text-xs text-[var(--muted)] m-0 capitalize">{user?.role || 'User'}</p>
            </div>
            <button
              onClick={() => handleNavClick('settings')}
              className="p-1 rounded hover:bg-[var(--accent)]/10 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-5 h-5 text-[var(--muted)] cursor-pointer shrink-0" />
            </button>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded border border-[var(--border)] bg-[var(--white)] text-[var(--muted)] text-sm font-medium cursor-pointer hover:bg-[var(--cream)] transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
