'use client';

import { X, Bell, CheckCircle, AlertCircle, Info, AlertTriangle, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { useAppStore, AppNotification } from '@/store/app-store';
import { useMemo } from 'react';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const {
    dataStatus,
    notifications,
    dismissedNotificationIds,
    dismissNotification,
    clearAllNotifications,
    setCurrentPage,
    setActiveTab,
    loadDataFromS3,
    isLoading,
  } = useAppStore();

  // Filter out dismissed notifications
  const activeNotifications = useMemo(() => {
    return notifications.filter((n) => !dismissedNotificationIds.includes(n.id));
  }, [notifications, dismissedNotificationIds]);

  // Handle notification action click
  const handleNotificationAction = (notification: AppNotification) => {
    if (notification.actionPage) {
      setCurrentPage(notification.actionPage);
      if (notification.actionTab) {
        setActiveTab(notification.actionTab);
      }
      onClose();
    }
  };

  // Get icon for notification type
  const getNotificationIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-[var(--success)]" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-[var(--warning)]" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-[var(--error)]" />;
      default:
        return <Info className="w-4 h-4 text-[var(--accent)]" />;
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Data status items
  const dataStatusItems = [
    { key: 'sales', label: 'Sales', status: dataStatus.sales },
    { key: 'brands', label: 'Brands', status: dataStatus.brands },
    { key: 'products', label: 'Products', status: dataStatus.products },
    { key: 'customers', label: 'Customers', status: dataStatus.customers },
    { key: 'budtenders', label: 'Budtenders', status: dataStatus.budtenders },
    { key: 'mappings', label: 'Mappings', status: dataStatus.mappings },
    { key: 'invoices', label: 'Invoices', status: dataStatus.invoices },
  ];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Toast Panel */}
      <div className="absolute top-full right-0 mt-2 w-[600px] max-w-[calc(100vw-2rem)] bg-[var(--white)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--paper)]">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[var(--accent)]" />
            <h3 className="font-semibold text-[var(--ink)]">Notification Center</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent)]/10 transition-colors"
          >
            <X className="w-5 h-5 text-[var(--muted)]" />
          </button>
        </div>

        {/* Content - Two Columns */}
        <div className="flex divide-x divide-[var(--border)] max-h-[400px]">
          {/* Left Column - Data Status */}
          <div className="w-1/2 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Data Status
              </h4>
              <button
                onClick={() => loadDataFromS3()}
                disabled={isLoading}
                className="p-1 rounded hover:bg-[var(--accent)]/10 disabled:opacity-50"
                title="Refresh data"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-[var(--accent)]" />
                )}
              </button>
            </div>
            <div className="space-y-2">
              {dataStatusItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between py-1.5 px-2 rounded bg-[var(--paper)]"
                >
                  <span className="text-sm text-[var(--ink)]">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        item.status.loaded ? 'text-[var(--success)]' : 'text-[var(--warning)]'
                      }`}
                    >
                      {item.status.count.toLocaleString()}
                    </span>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        item.status.loaded ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
            {dataStatus.sales.lastUpdated && (
              <p className="text-xs text-[var(--muted)] mt-3">
                Last updated: {formatTimestamp(dataStatus.sales.lastUpdated)}
              </p>
            )}
          </div>

          {/* Right Column - Notifications */}
          <div className="w-1/2 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Notifications
              </h4>
              {activeNotifications.length > 0 && (
                <button
                  onClick={clearAllNotifications}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>

            {activeNotifications.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="w-8 h-8 text-[var(--muted)] opacity-30 mx-auto mb-2" />
                <p className="text-sm text-[var(--muted)]">No new notifications</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="relative p-3 rounded bg-[var(--paper)] border border-[var(--border)]"
                  >
                    {/* Dismiss button */}
                    <button
                      onClick={() => dismissNotification(notification.id)}
                      className="absolute top-2 right-2 p-0.5 rounded hover:bg-[var(--accent)]/10"
                    >
                      <X className="w-3 h-3 text-[var(--muted)]" />
                    </button>

                    <div className="flex items-start gap-2 pr-5">
                      {getNotificationIcon(notification.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)] leading-tight">
                          {notification.title}
                        </p>
                        <p className="text-xs text-[var(--muted)] mt-0.5 leading-snug">
                          {notification.message}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-[var(--muted)]">
                            {formatTimestamp(notification.timestamp)}
                          </span>
                          {notification.actionLabel && (
                            <button
                              onClick={() => handleNotificationAction(notification)}
                              className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                            >
                              {notification.actionLabel}
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
