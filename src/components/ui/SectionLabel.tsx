'use client';

import { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <span className={`text-xs font-semibold tracking-[0.15em] uppercase text-[var(--accent)] block mb-2 ${className}`}>
      {children}
    </span>
  );
}
