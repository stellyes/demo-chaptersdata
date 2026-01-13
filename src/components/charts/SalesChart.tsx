'use client';

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
import { CHART_COLORS } from '@/lib/config';

interface SalesChartProps {
  data: Array<{
    date: string;
    grass_roots?: number;
    barbary_coast?: number;
    combined?: number;
  }>;
  metric?: 'revenue' | 'transactions' | 'margin';
  showLegend?: boolean;
}

export function SalesChart({ data, metric = 'revenue', showLegend = true }: SalesChartProps) {
  const formatYAxis = (value: number) => {
    if (metric === 'revenue') {
      return `$${(value / 1000).toFixed(0)}k`;
    }
    if (metric === 'margin') {
      return `${value.toFixed(0)}%`;
    }
    return value.toFixed(0);
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradientGR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.stores.grass_roots} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.stores.grass_roots} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradientBC" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.stores.barbary_coast} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.stores.barbary_coast} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={formatYAxis}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0ddd8',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}
          formatter={(value) => [formatYAxis(Number(value)), '']}
        />
        {showLegend && <Legend />}
        <Area
          type="monotone"
          dataKey="grass_roots"
          name="Grass Roots"
          stroke={CHART_COLORS.stores.grass_roots}
          strokeWidth={2}
          fill="url(#gradientGR)"
        />
        <Area
          type="monotone"
          dataKey="barbary_coast"
          name="Barbary Coast"
          stroke={CHART_COLORS.stores.barbary_coast}
          strokeWidth={2}
          fill="url(#gradientBC)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Transaction count chart (similar to SalesChart but formatted for counts)
interface TransactionChartProps {
  data: Array<{
    date: string;
    grass_roots?: number;
    barbary_coast?: number;
  }>;
  showLegend?: boolean;
}

export function TransactionChart({ data, showLegend = true }: TransactionChartProps) {
  const formatYAxis = (value: number) => {
    return value.toLocaleString();
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradientGRTx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.stores.grass_roots} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.stores.grass_roots} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradientBCTx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.stores.barbary_coast} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.stores.barbary_coast} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={formatYAxis}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0ddd8',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}
          formatter={(value) => [Number(value).toLocaleString(), 'Transactions']}
        />
        {showLegend && <Legend />}
        <Area
          type="monotone"
          dataKey="grass_roots"
          name="Grass Roots"
          stroke={CHART_COLORS.stores.grass_roots}
          strokeWidth={2}
          fill="url(#gradientGRTx)"
        />
        <Area
          type="monotone"
          dataKey="barbary_coast"
          name="Barbary Coast"
          stroke={CHART_COLORS.stores.barbary_coast}
          strokeWidth={2}
          fill="url(#gradientBCTx)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleLineChart({
  data,
  dataKey,
  color = CHART_COLORS.primary,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" vertical={false} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b6b6b', fontSize: 12 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0ddd8',
            borderRadius: '8px',
          }}
        />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
