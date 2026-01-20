'use client';

import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  changeType?: 'positive' | 'negative';
  icon: LucideIcon;
  subtitle?: string;
}

export function MetricCard({ title, value, change, changeType, icon: Icon, subtitle }: MetricCardProps) {
  return (
    <div className="metric-card bg-white rounded-lg p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] cursor-pointer">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-[var(--accent)]" />
        </div>
        {change !== undefined && changeType && (
          <div className={`flex items-center gap-1 text-sm font-medium ${
            changeType === 'positive' ? 'text-[var(--success)]' : 'text-[var(--error)]'
          }`}>
            {changeType === 'positive' ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-[var(--muted)] text-sm font-medium mb-1">{title}</p>
        <p className="text-3xl font-semibold text-[var(--ink)] font-serif tracking-tight">{value}</p>
        {subtitle && <p className="text-[var(--muted)] text-xs mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
