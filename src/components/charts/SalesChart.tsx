'use client';

import { memo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS, STORES, getIndividualStoreIds, getStoreColor } from '@/lib/config';

interface SalesChartProps {
  data: Array<Record<string, string | number | undefined>>;
  metric?: 'revenue' | 'transactions' | 'margin';
  showLegend?: boolean;
  yDomain?: [number, number];
}

const storeIds = getIndividualStoreIds();

export const SalesChart = memo(function SalesChart({ data, metric = 'revenue', showLegend = true, yDomain }: SalesChartProps) {
  const formatYAxis = (value: number) => {
    if (metric === 'revenue') return `$${(value / 1000).toFixed(0)}k`;
    if (metric === 'margin') return `${value.toFixed(0)}%`;
    return value.toFixed(0);
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          {storeIds.map((id) => (
            <linearGradient key={`gradient-${id}`} id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={getStoreColor(id)} stopOpacity={0.2} />
              <stop offset="95%" stopColor={getStoreColor(id)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} tickFormatter={formatYAxis} domain={yDomain || ['auto', 'auto']} />
        <Tooltip
          contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e0ddd8', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
          formatter={(value) => [formatYAxis(Number(value)), '']}
        />
        {showLegend && <Legend />}
        {storeIds.map((id) => (
          <Area key={id} type="monotone" dataKey={id} name={STORES[id]?.name ?? id} stroke={getStoreColor(id)} strokeWidth={2} fill={`url(#gradient-${id})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
});

interface TransactionChartProps {
  data: Array<Record<string, string | number | undefined>>;
  showLegend?: boolean;
}

export const TransactionChart = memo(function TransactionChart({ data, showLegend = true }: TransactionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          {storeIds.map((id) => (
            <linearGradient key={`gradient-tx-${id}`} id={`gradient-tx-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={getStoreColor(id)} stopOpacity={0.2} />
              <stop offset="95%" stopColor={getStoreColor(id)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} tickFormatter={(v) => v.toLocaleString()} />
        <Tooltip
          contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e0ddd8', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
          formatter={(value) => [Number(value).toLocaleString(), 'Transactions']}
        />
        {showLegend && <Legend />}
        {storeIds.map((id) => (
          <Area key={id} type="monotone" dataKey={id} name={STORES[id]?.name ?? id} stroke={getStoreColor(id)} strokeWidth={2} fill={`url(#gradient-tx-${id})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const SimpleLineChart = memo(function SimpleLineChart({ data, dataKey, color = CHART_COLORS.primary }: { data: Array<Record<string, unknown>>; dataKey: string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e0ddd8', borderRadius: '8px' }} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});
