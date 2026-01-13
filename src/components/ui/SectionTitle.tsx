'use client';

import { ReactNode } from 'react';

interface SectionTitleProps {
  children: ReactNode;
}

export function SectionTitle({ children }: SectionTitleProps) {
  return (
    <h3 className="font-serif text-2xl font-medium text-[var(--ink)] tracking-tight m-0 mb-6">
      {children}
    </h3>
  );
}
