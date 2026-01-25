'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, UserX, LogOut, X } from 'lucide-react';

export type SessionInvalidReason = 'logged_out' | 'different_user' | 'no_session';

interface SessionToastProps {
  isVisible: boolean;
  reason: SessionInvalidReason | null;
  onClose: () => void;
  redirectingIn?: number; // seconds
}

const MESSAGES: Record<SessionInvalidReason, { title: string; message: string; Icon: typeof AlertCircle }> = {
  logged_out: {
    title: 'Session Ended',
    message: 'You have been logged out from another tab or device.',
    Icon: LogOut,
  },
  different_user: {
    title: 'Account Changed',
    message: 'A different account was logged in. Redirecting to login...',
    Icon: UserX,
  },
  no_session: {
    title: 'Session Expired',
    message: 'Your session has expired. Please log in again.',
    Icon: AlertCircle,
  },
};

export function SessionToast({
  isVisible,
  reason,
  onClose,
  redirectingIn = 3,
}: SessionToastProps) {
  const [countdown, setCountdown] = useState(redirectingIn);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    if (!isVisible || !reason) {
      setCountdown(redirectingIn);
      setIsAnimatingOut(false);
      return;
    }

    setCountdown(redirectingIn);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isVisible, reason, redirectingIn]);

  useEffect(() => {
    if (countdown === 0 && isVisible) {
      setIsAnimatingOut(true);
      const timeout = setTimeout(onClose, 300);
      return () => clearTimeout(timeout);
    }
  }, [countdown, isVisible, onClose]);

  if (!isVisible || !reason) return null;

  const { title, message, Icon } = MESSAGES[reason];

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div
        className={`
          mt-4 px-5 py-4 rounded-lg shadow-2xl pointer-events-auto
          flex items-start gap-4 max-w-md
          bg-amber-50 border border-amber-200 text-amber-900
          dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-100
          transform transition-all duration-300 ease-out
          ${isAnimatingOut ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}
        `}
      >
        <Icon className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />

        <div className="flex-1">
          <h4 className="font-semibold text-sm">{title}</h4>
          <p className="text-sm mt-1 opacity-90">{message}</p>
          {countdown > 0 && (
            <p className="text-xs mt-2 opacity-70">
              Redirecting in {countdown} second{countdown !== 1 ? 's' : ''}...
            </p>
          )}
        </div>

        <button
          onClick={() => {
            setIsAnimatingOut(true);
            setTimeout(onClose, 300);
          }}
          className="text-amber-600 dark:text-amber-400 hover:opacity-70 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
