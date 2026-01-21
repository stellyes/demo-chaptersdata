'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

// Rotating loading messages
const LOADING_MESSAGES = [
  'Brewing insights...',
  'Crunching numbers...',
  'Analyzing patterns...',
  'Connecting the dots...',
  'Mining data gold...',
  'Unlocking trends...',
  'Synthesizing reports...',
  'Processing transactions...',
  'Fetching from cloud...',
  'Loading analytics...',
];

interface LoadingToastProps {
  isVisible: boolean;
  message?: string;
  /** If true, show immediately without delay */
  immediate?: boolean;
  /** Delay in ms before showing the toast (default: 2000ms, ignored if immediate=true) */
  delayMs?: number;
}

export function LoadingToast({
  isVisible,
  message,
  immediate = false,
  delayMs = 2000,
}: LoadingToastProps) {
  const [shouldShow, setShouldShow] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isMessageAnimating, setIsMessageAnimating] = useState(false);
  const showTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle visibility with delay (or immediate)
  useEffect(() => {
    if (isVisible) {
      if (immediate) {
        // Show immediately for tab switches
        setShouldShow(true);
        setIsAnimatingOut(false);
      } else {
        // Show after delay for long operations
        showTimerRef.current = setTimeout(() => {
          setShouldShow(true);
          setIsAnimatingOut(false);
        }, delayMs);
      }
    } else {
      // Clear the show timer if loading finishes before delay
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      // Animate out if currently showing
      if (shouldShow) {
        setIsAnimatingOut(true);
        setTimeout(() => {
          setShouldShow(false);
          setIsAnimatingOut(false);
        }, 300);
      }
    }

    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
      }
    };
  }, [isVisible, immediate, delayMs, shouldShow]);

  // Rotate messages every 2.5 seconds (only when showing and no custom message)
  useEffect(() => {
    if (!shouldShow || message) return;

    const interval = setInterval(() => {
      setIsMessageAnimating(true);
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        setIsMessageAnimating(false);
      }, 200);
    }, 2500);

    return () => clearInterval(interval);
  }, [shouldShow, message]);

  // Reset message index when toast first shows
  useEffect(() => {
    if (shouldShow) {
      setMessageIndex(0);
    }
  }, [shouldShow]);

  if (!shouldShow) return null;

  const displayMessage = message || LOADING_MESSAGES[messageIndex];

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        className={`
          mt-4 px-5 py-3 rounded-lg shadow-2xl pointer-events-auto
          flex items-center gap-3
          bg-[var(--ink)] text-[var(--paper)]
          transform transition-all duration-300 ease-out
          ${isAnimatingOut ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}
        `}
        style={{
          animation: !isAnimatingOut ? 'slideDown 0.3s ease-out' : undefined,
        }}
      >
        {/* Spinner */}
        <Loader2 className="w-5 h-5 animate-spin text-[#4CAF50] flex-shrink-0" />

        {/* Message */}
        <span
          className={`text-sm font-medium transition-opacity duration-200 ${
            isMessageAnimating ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {displayMessage}
        </span>

        {/* Progress bar */}
        <div className="w-20 h-1.5 bg-white/20 rounded-full overflow-hidden ml-2">
          <div className="loading-progress h-full rounded-full bg-gradient-to-r from-[#3d6b3e] to-[#4CAF50]" />
        </div>
      </div>

      <style jsx>{`
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .loading-progress {
          animation: progress 2s ease-in-out infinite;
        }

        @keyframes progress {
          0% {
            width: 0%;
          }
          50% {
            width: 80%;
          }
          100% {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
