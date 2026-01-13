'use client';

import { Search, Bell, Calendar } from 'lucide-react';
import { useAppStore } from '@/store/app-store';

interface HeaderProps {
  title: string;
  subtitle: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { dateRange, setDateRange } = useAppStore();

  return (
    <header className="flex items-center justify-between mb-8 pb-6 border-b border-[var(--border)]">
      <div>
        <span className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--accent)] block mb-2">
          {subtitle}
        </span>
        <h2 className="font-serif text-4xl font-medium text-[var(--ink)] tracking-tight m-0">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-4">
        {/* Date Range Picker */}
        <div className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded bg-white">
          <Calendar className="w-4 h-4 text-[var(--muted)]" />
          <input
            type="date"
            value={dateRange?.start || ''}
            onChange={(e) =>
              setDateRange(
                e.target.value
                  ? { start: e.target.value, end: dateRange?.end || e.target.value }
                  : null
              )
            }
            className="border-none text-sm text-[var(--ink)] bg-transparent"
          />
          <span className="text-[var(--muted)]">to</span>
          <input
            type="date"
            value={dateRange?.end || ''}
            onChange={(e) =>
              setDateRange(
                e.target.value
                  ? { start: dateRange?.start || e.target.value, end: e.target.value }
                  : null
              )
            }
            className="border-none text-sm text-[var(--ink)] bg-transparent"
          />
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-white border border-[var(--border)] rounded pl-10 pr-4 py-2.5 text-sm text-[var(--ink)] w-48 font-sans"
          />
        </div>
        {/* Notifications */}
        <button className="relative p-2.5 bg-white border border-[var(--border)] rounded cursor-pointer">
          <Bell className="w-5 h-5 text-[var(--muted)]" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--accent)] rounded-full"></span>
        </button>
      </div>
    </header>
  );
}
