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
  // Prepare data with normalized size values
  // Filter out: zero/negative sales, 100% margins (malformed data), and empty brand names
  const filteredData = data
    .slice(0, 100)
    .filter((b) => b.net_sales > 0 && b.gross_margin_pct < 100 && b.brand && b.brand.trim() !== '');

  // Calculate min/max for normalization
  const minSales = Math.min(...filteredData.map((b) => b.net_sales));
  const maxSales = Math.max(...filteredData.map((b) => b.net_sales));
  const minMargin = Math.min(...filteredData.map((b) => b.gross_margin_pct));
  const maxMargin = Math.max(...filteredData.map((b) => b.gross_margin_pct));

  // Normalize size using square root scale for better visual differentiation
  // This prevents large values from dominating and makes differences more visible
  const normalizeSize = (value: number) => {
    const sqrtMin = Math.sqrt(minSales);
    const sqrtMax = Math.sqrt(maxSales);
    const sqrtValue = Math.sqrt(value);
    // Normalize to 0-1 range, then scale to desired size range
    const normalized = (sqrtValue - sqrtMin) / (sqrtMax - sqrtMin || 1);
    return 80 + normalized * 320; // Range from 80 to 400 pixels
  };

  const chartData = filteredData.map((b) => ({
    name: b.brand,
    x: b.net_sales,
    y: b.gross_margin_pct,
    z: normalizeSize(b.net_sales),
    originalSales: b.net_sales,
  }));

  // Calculate Y-axis domain with 5% padding below minimum
  const yMin = Math.max(0, Math.floor(minMargin / 5) * 5 - 5);
  const yMax = Math.min(100, Math.ceil(maxMargin / 5) * 5 + 5);

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
          domain={[yMin, yMax]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#6b6b6b', fontSize: 12 }}
          tickFormatter={(v) => `${v}%`}
        />
        <ZAxis type="number" dataKey="z" range={[80, 400]} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length > 0) {
              const data = payload[0].payload;
              return (
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e0ddd8',
                    borderRadius: '8px',
                    padding: '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600, marginBottom: '8px', color: '#1e391f' }}>
                    {data.name}
                  </p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#6b6b6b' }}>
                    Revenue: <span style={{ fontWeight: 500, color: '#1e391f' }}>${data.x.toLocaleString()}</span>
                  </p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#6b6b6b' }}>
                    Margin: <span style={{ fontWeight: 500, color: '#1e391f' }}>{data.y.toFixed(1)}%</span>
                  </p>
                </div>
              );
            }
            return null;
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
