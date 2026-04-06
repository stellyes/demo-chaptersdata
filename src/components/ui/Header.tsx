'use client';

import { Bell, Search, ChevronRight, Calendar } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useAppStore, PageType } from '@/store/app-store';
import { NotificationCenter } from './NotificationCenter';

// Search index for all searchable sections in the app
interface SearchableSection {
  id: string;
  label: string;
  page: PageType;
  tabId?: string;
  keywords: string[];
}

const SEARCHABLE_SECTIONS: SearchableSection[] = [
  // Dashboard
  { id: 'dashboard', label: 'Dashboard', page: 'dashboard', keywords: ['dashboard', 'home', 'overview', 'summary', 'kpi'] },

  // Sales Analytics tabs
  { id: 'sales-trends', label: 'Sales Analytics > Sales Trends', page: 'sales', tabId: 'trends', keywords: ['sales', 'trends', 'revenue', 'chart', 'graph', 'performance'] },
  { id: 'sales-brands', label: 'Sales Analytics > Brand Performance', page: 'sales', tabId: 'brands', keywords: ['brand', 'brands', 'performance', 'margin', 'untapped', 'high margin'] },
  { id: 'sales-categories', label: 'Sales Analytics > Product Categories', page: 'sales', tabId: 'categories', keywords: ['product', 'category', 'categories', 'type', 'flower', 'edible', 'concentrate'] },
  { id: 'sales-daily', label: 'Sales Analytics > Daily Breakdown', page: 'sales', tabId: 'daily', keywords: ['daily', 'breakdown', 'day', 'date', 'calendar'] },
  { id: 'sales-raw', label: 'Sales Analytics > Raw Data', page: 'sales', tabId: 'raw', keywords: ['raw', 'data', 'export', 'table', 'records'] },
  { id: 'sales-customers', label: 'Sales Analytics > Customer Analytics', page: 'sales', tabId: 'customers', keywords: ['customer', 'customers', 'analytics', 'segment', 'vip', 'loyalty'] },
  { id: 'sales-budtenders', label: 'Sales Analytics > Budtender Analytics', page: 'sales', tabId: 'budtenders', keywords: ['budtender', 'budtenders', 'employee', 'staff', 'performance'] },
  { id: 'sales-invoices', label: 'Sales Analytics > Invoice Analytics', page: 'sales', tabId: 'invoices', keywords: ['invoice', 'invoices', 'purchasing', 'bought', 'purchase', 'spend', 'vendor', 'supplier', 'cost'] },

  // Recommendations tabs
  { id: 'recommendations-ai', label: 'Recommendations > AI Analysis', page: 'recommendations', tabId: 'ai', keywords: ['ai', 'analysis', 'claude', 'recommendations', 'insights', 'suggestions'] },
  { id: 'recommendations-custom', label: 'Recommendations > Custom Query', page: 'recommendations', tabId: 'custom', keywords: ['custom', 'query', 'question', 'ask', 'claude', 'prompt'] },
  { id: 'recommendations-history', label: 'Recommendations > Past Reports', page: 'recommendations', tabId: 'history', keywords: ['history', 'past', 'reports', 'previous', 'recommendations', 'saved'] },
  { id: 'recommendations-learning', label: 'Recommendations > Learning Progress', page: 'recommendations', tabId: 'learning', keywords: ['learning', 'progress', 'daily', 'digest', 'intelligence', 'brain'] },

  // Data Center tabs
  { id: 'data-sales', label: 'Data Center > Sales Data', page: 'data-center', tabId: 'sales', keywords: ['sales', 'data', 'upload', 'import'] },
  { id: 'data-invoice', label: 'Data Center > Invoice Data', page: 'data-center', tabId: 'invoice', keywords: ['invoice', 'invoices', 'purchase', 'order', 'supplier'] },
  { id: 'data-customer', label: 'Data Center > Customer Data', page: 'data-center', tabId: 'customer', keywords: ['customer', 'customers', 'data', 'upload'] },
  { id: 'data-budtender', label: 'Data Center > Budtender Performance', page: 'data-center', tabId: 'budtender', keywords: ['budtender', 'employee', 'performance', 'assignment'] },
  { id: 'data-context', label: 'Data Center > Define Context', page: 'data-center', tabId: 'context', keywords: ['context', 'define', 'business', 'settings', 'configuration'] },
  { id: 'data-mapping', label: 'Data Center > Brand Mapping', page: 'data-center', tabId: 'brand-mapping', keywords: ['brand', 'mapping', 'alias', 'product', 'type', 'category'] },
  { id: 'data-research', label: 'Data Center > Industry Research', page: 'data-center', tabId: 'research', keywords: ['research', 'industry', 'market', 'analysis', 'report'] },
  { id: 'data-seo', label: 'Data Center > SEO Analysis', page: 'data-center', tabId: 'seo', keywords: ['seo', 'search', 'optimization', 'google', 'ranking', 'keywords'] },
  { id: 'data-qr', label: 'Data Center > QR Portal', page: 'data-center', tabId: 'qr', keywords: ['qr', 'code', 'portal', 'scan', 'link', 'url'] },

  // Compliance tabs
  { id: 'compliance-alerts', label: 'Compliance > Active Alerts', page: 'compliance', tabId: 'alerts', keywords: ['compliance', 'alerts', 'violations', 'risk', 'critical', 'warning'] },
  { id: 'compliance-scans', label: 'Compliance > Scan History', page: 'compliance', tabId: 'scans', keywords: ['compliance', 'scan', 'scans', 'history', 'pipeline', 'daily'] },
  { id: 'compliance-rules', label: 'Compliance > Rule Browser', page: 'compliance', tabId: 'rules', keywords: ['compliance', 'rules', 'regulations', 'jurisdiction', 'thc', 'tracking', 'cannabis'] },
];

interface HeaderProps {
  title: string;
  subtitle: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { setCurrentPage, setActiveTab, notifications, dismissedNotificationIds, dateRange, setDateRange } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);

  // Count unread notifications
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !dismissedNotificationIds.includes(n.id)).length;
  }, [notifications, dismissedNotificationIds]);

  // Filter search results based on query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return SEARCHABLE_SECTIONS.filter(section => {
      if (section.label.toLowerCase().includes(query)) return true;
      return section.keywords.some(keyword => keyword.includes(query));
    }).slice(0, 6);
  }, [searchQuery]);

  // Handle search result click
  const handleSearchResultClick = (section: SearchableSection) => {
    setCurrentPage(section.page);
    if (section.tabId) {
      setActiveTab(section.tabId);
    }
    setSearchQuery('');
    setSearchFocused(false);
  };

  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between mb-6 md:mb-8 pb-4 md:pb-6 border-b border-[var(--border)] gap-3 lg:gap-6">
      <div className="min-w-0">
        <span className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--accent)] block mb-1 md:mb-2">
          {subtitle}
        </span>
        <h2 className="font-serif text-2xl md:text-4xl font-medium text-[var(--ink)] tracking-tight m-0">
          {title}
        </h2>
      </div>
      {/* Right panel: [search+datepicker col] + [bell] — side by side at lg */}
      <div className="flex flex-col sm:flex-row lg:flex-row items-start sm:items-center lg:items-center gap-3 w-full sm:w-auto shrink-0">
        {/* Search + Datepicker — stacked at lg, row at xl (the anchor) */}
        <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center lg:items-stretch xl:items-center gap-1.5 xl:gap-3 w-full sm:w-auto">
        {/* Search */}
        <div className="relative w-full sm:w-auto">
          <Search className="w-5 h-5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search sections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            className="bg-[var(--white)] border border-[var(--border)] rounded pl-10 pr-4 py-2.5 text-sm text-[var(--ink)] w-full sm:w-48 md:w-56 lg:w-full xl:w-56 font-sans"
          />
          {/* Search Results Dropdown */}
          {searchFocused && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--white)] border border-[var(--border)] rounded shadow-lg z-50 max-h-64 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSearchResultClick(result)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--accent)]/5 transition-colors"
                >
                  <span className="text-[var(--ink)]">{result.label}</span>
                  <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
                </button>
              ))}
            </div>
          )}
          {searchFocused && searchQuery && searchResults.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--white)] border border-[var(--border)] rounded shadow-lg z-50 px-3 py-2 text-sm text-[var(--muted)]">
              No results found
            </div>
          )}
        </div>
        {/* Date Range Picker */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] w-full sm:w-auto lg:w-full xl:w-auto">
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
            className="border-none text-sm text-[var(--ink)] bg-transparent min-w-0 flex-1 sm:flex-none"
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
            className="border-none text-sm text-[var(--ink)] bg-transparent min-w-0 flex-1 sm:flex-none"
          />
        </div>
        </div>{/* end search+datepicker inner col */}
        {/* Bell — to the right of the stacked controls, vertically centered */}
        <div className="relative hidden lg:flex items-center self-center">
          <button
            onClick={() => setNotificationOpen(!notificationOpen)}
            className="relative p-2.5 bg-[var(--white)] border border-[var(--border)] rounded cursor-pointer hover:bg-[var(--paper)] transition-colors"
          >
            <Bell className="w-5 h-5 text-[var(--muted)]" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--accent)] text-white text-xs font-medium rounded-full px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <NotificationCenter
            isOpen={notificationOpen}
            onClose={() => setNotificationOpen(false)}
          />
        </div>
      </div>{/* end right panel */}
    </header>
  );
}
