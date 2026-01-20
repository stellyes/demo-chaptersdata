'use client';

import {
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  ZAxis,
} from 'recharts';
import { CHART_COLORS, BRAND_THRESHOLDS } from '@/lib/config';
import { BrandRecord } from '@/types';

interface TopBrandsChartProps {
  data: BrandRecord[];
  limit?: number;
}

export function TopBrandsChart({ data, limit = 20 }: TopBrandsChartProps) {
  const chartData = data.slice(0, limit).map((b) => ({
    name: b.brand.length > 20 ? b.brand.slice(0, 20) + '...' : b.brand,
    revenue: b.net_sales,
    margin: b.gross_margin_pct,
  }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 100 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" horizontal={true} vertical={false} />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis
          type="category"
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 11 }}
          width={100}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0ddd8',
            borderRadius: '8px',
          }}
          formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Revenue']}
        />
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                entry.margin >= BRAND_THRESHOLDS.highMargin
                  ? CHART_COLORS.primary
                  : entry.margin >= BRAND_THRESHOLDS.lowMargin
                  ? CHART_COLORS.secondary
                  : '#8b1414'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface MarginScatterProps {
  data: BrandRecord[];
}

export function MarginScatterChart({ data }: MarginScatterProps) {
  const chartData = data.slice(0, 100).map((b) => ({
    name: b.brand,
    x: b.net_sales,
    y: b.gross_margin_pct,
    z: b.net_sales,
  }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0ddd8" />
        <XAxis
          type="number"
          dataKey="x"
          name="Net Sales"
          scale="log"
          domain={['auto', 'auto']}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Margin"
          domain={[0, 100]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={(v) => `${v}%`}
        />
        <ZAxis type="number" dataKey="z" range={[50, 400]} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0ddd8',
            borderRadius: '8px',
          }}
          formatter={(value, name) => {
            const numValue = Number(value);
            if (name === 'Net Sales') return [`$${numValue.toLocaleString()}`, name];
            if (name === 'Margin') return [`${numValue.toFixed(1)}%`, name];
            return [value, name];
          }}
        />
        <ReferenceLine
          y={BRAND_THRESHOLDS.targetMargin}
          stroke={CHART_COLORS.primary}
          strokeDasharray="4 4"
          label={{ value: `${BRAND_THRESHOLDS.targetMargin}% Target`, fill: '#6b6b6b', fontSize: 11 }}
        />
        <Scatter name="Brands" data={chartData}>
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                entry.y >= BRAND_THRESHOLDS.highMargin
                  ? CHART_COLORS.primary
                  : entry.y >= BRAND_THRESHOLDS.lowMargin
                  ? CHART_COLORS.tertiary
                  : '#8b1414'
              }
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
