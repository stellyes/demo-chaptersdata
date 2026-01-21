'use client';

import { useAppStore } from '@/store/app-store';
import { LoadingToast } from '@/components/ui/LoadingToast';

export function LoadingOverlayProvider({ children }: { children: React.ReactNode }) {
  const { loadingOverlay } = useAppStore();

  return (
    <>
      {children}
      <LoadingToast
        isVisible={loadingOverlay.visible}
        message={loadingOverlay.message}
        immediate={loadingOverlay.immediate}
        delayMs={2000}
      />
    </>
  );
}
