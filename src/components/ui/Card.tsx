'use client';

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-white rounded-lg p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}
