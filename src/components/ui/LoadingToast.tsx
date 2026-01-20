'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Clock } from 'lucide-react';

// Rotating loading messages matching the Streamlit app
const LOADING_MESSAGES = [
  'Brewing insights...',
  'Crunching numbers...',
  'Analyzing patterns...',
  'Connecting the dots...',
  'Mining data gold...',
  'Unlocking trends...',
  'Synthesizing reports...',
  'Calculating margins...',
  'Processing transactions...',
  'Building dashboards...',
  'Fetching from cloud...',
  'Optimizing queries...',
  'Loading analytics...',
  'Preparing visuals...',
  'Aggregating metrics...',
];

// Delay before showing extended loading message (30 seconds)
const EXTENDED_LOADING_DELAY = 30000;

interface LoadingToastProps {
  isVisible: boolean;
  dataStatus?: {
    sales: { loaded: boolean; count: number };
    brands: { loaded: boolean; count: number };
    products: { loaded: boolean; count: number };
    customers: { loaded: boolean; count: number };
    budtenders: { loaded: boolean; count: number };
    mappings: { loaded: boolean; count: number };
    invoices: { loaded: boolean; count: number };
  };
}

export function LoadingToast({ isVisible, dataStatus }: LoadingToastProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showExtendedMessage, setShowExtendedMessage] = useState(false);
  const extendedTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Rotate messages every 2 seconds
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        setIsAnimating(false);
      }, 300);
    }, 2000);

    return () => clearInterval(interval);
  }, [isVisible]);

  // Reset message index when toast becomes visible
  useEffect(() => {
    if (isVisible) {
      setMessageIndex(0);
    }
  }, [isVisible]);

  // Show extended loading message after 30 seconds
  useEffect(() => {
    if (isVisible) {
      // Start timer for extended message
      extendedTimerRef.current = setTimeout(() => {
        setShowExtendedMessage(true);
      }, EXTENDED_LOADING_DELAY);
    } else {
      // Reset when toast hides
      setShowExtendedMessage(false);
      if (extendedTimerRef.current) {
        clearTimeout(extendedTimerRef.current);
        extendedTimerRef.current = null;
      }
    }

    return () => {
      if (extendedTimerRef.current) {
        clearTimeout(extendedTimerRef.current);
      }
    };
  }, [isVisible]);

  if (!isVisible) return null;

  // Calculate loaded items for progress display
  const loadedItems = dataStatus
    ? Object.entries(dataStatus).filter(([, status]) => status.loaded).length
    : 0;
  const totalItems = dataStatus ? Object.keys(dataStatus).length : 7;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-[var(--ink)] text-[var(--paper)] rounded-lg shadow-2xl overflow-hidden min-w-[320px]">
        {/* Progress bar */}
        <div className="h-1 bg-[var(--ink)]">
          <div
            className="h-full bg-gradient-to-r from-[#3d6b3e] to-[#4CAF50] transition-all duration-500"
            style={{ width: `${(loadedItems / totalItems) * 100}%` }}
          />
        </div>

        <div className="p-4">
          {/* Header with spinner */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative">
              <Loader2 className="w-6 h-6 text-[#4CAF50] animate-spin" />
            </div>
            <div>
              <p className="font-semibold text-sm">Loading Data</p>
              <p
                className={`text-xs text-[var(--paper)]/70 transition-opacity duration-300 ${
                  isAnimating ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {LOADING_MESSAGES[messageIndex]}
              </p>
            </div>
          </div>

          {/* Data status indicators */}
          {dataStatus && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <DataStatusItem label="Sales" status={dataStatus.sales} />
              <DataStatusItem label="Brands" status={dataStatus.brands} />
              <DataStatusItem label="Products" status={dataStatus.products} />
              <DataStatusItem label="Customers" status={dataStatus.customers} />
              <DataStatusItem label="Budtenders" status={dataStatus.budtenders} />
              <DataStatusItem label="Mappings" status={dataStatus.mappings} />
              <DataStatusItem label="Invoices" status={dataStatus.invoices} />
            </div>
          )}

          {/* Pulsing dots */}
          <div className="flex justify-center gap-1 mt-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#4CAF50]"
                style={{
                  animation: 'pulse 1.5s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>

          {/* Extended loading message - shows after 30 seconds */}
          {showExtendedMessage && (
            <div className="mt-4 pt-3 border-t border-[var(--paper)]/10 animate-in fade-in duration-500">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-[var(--paper)]/60 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-[var(--paper)]/70 leading-relaxed">
                  Initial data synchronization may take a few minutes.
                  Your dashboard is working in the background — feel free to wait
                  while we prepare your analytics.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function DataStatusItem({
  label,
  status,
}: {
  label: string;
  status: { loaded: boolean; count: number };
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--paper)]/60">{label}</span>
      {status.loaded ? (
        <span className="text-[#4CAF50] font-medium">{status.count.toLocaleString()}</span>
      ) : (
        <span className="text-[var(--paper)]/40">Loading...</span>
      )}
    </div>
  );
}
