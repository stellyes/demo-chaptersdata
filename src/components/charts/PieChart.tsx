'use client';

import { memo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHART_COLORS } from '@/lib/config';

interface CategoryPieChartProps {
  data: Array<{
    name: string;
    value: number;
  }>;
  showLegend?: boolean;
}

const PIE_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.quaternary,
  CHART_COLORS.quinary,
  '#2d5a2e',
  '#4a7d4b',
  '#68a069',
  '#86c387',
  '#a4e6a5',
];

export const CategoryPieChart = memo(function CategoryPieChart({ data, showLegend = true }: CategoryPieChartProps) {
  // Truncate long names for display
  const truncateName = (name: string, maxLength: number = 15) => {
    return name.length > maxLength ? name.slice(0, maxLength) + '...' : name;
  };

  // Calculate dynamic height based on legend rows needed
  const legendRows = showLegend ? Math.ceil(data.length / 4) : 0;
  const legendHeight = legendRows * 28;
  const chartHeight = 320 + legendHeight;

  return (
    <div style={{ width: '100%', height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 25, right: 30, bottom: legendHeight + 15, left: 30 }}>
          <Pie
            data={data}
            cx="50%"
            cy="42%"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#ffffff',
              border: '1px solid #e0ddd8',
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            }}
            formatter={(value, name) => [`$${Number(value).toLocaleString()}`, name]}
          />
          {showLegend && (
            <Legend
              layout="horizontal"
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{
                paddingTop: '8px',
                fontSize: '11px',
                lineHeight: '1.6',
              }}
              formatter={(value) => (
                <span style={{ color: '#333', fontSize: '11px' }}>{truncateName(String(value))}</span>
              )}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});

interface SegmentPieChartProps {
  data: Record<string, number>;
  title?: string;
}

export const SegmentPieChart = memo(function SegmentPieChart({ data }: SegmentPieChartProps) {
  // Filter out zero/NaN values and sort by value descending
  const chartData = Object.entries(data)
    .filter(([, value]) => value > 0 && !isNaN(value))
    .map(([name, value]) => ({
      name,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  // Calculate total for percentage
  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  // Custom label renderer - show labels for all visible segments (≥1%)
  const renderLabel = ({ cx, cy, midAngle, outerRadius, percent }: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    outerRadius?: number;
    percent?: number;
    index?: number;
  }) => {
    if (cx == null || cy == null || midAngle == null || outerRadius == null || percent == null) return null;
    if (percent < 0.01) return null; // Don't show labels for segments < 1%

    const RADIAN = Math.PI / 180;
    // Position labels further out for small segments to avoid overlap
    const radius = outerRadius + (percent < 0.1 ? 35 : 25);
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="#333"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={percent >= 0.1 ? 500 : 400}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  // Calculate dynamic height based on legend
  const legendRows = Math.ceil(chartData.length / 3);
  const legendHeight = legendRows * 28;
  const chartHeight = 340 + legendHeight;

  return (
    <div style={{ width: '100%', height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 30, right: 50, bottom: legendHeight + 15, left: 50 }}>
          <Pie
            data={chartData}
            cx="50%"
            cy="38%"
            innerRadius={45}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={renderLabel}
            labelLine={{ stroke: '#999', strokeWidth: 1 }}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#ffffff',
              border: '1px solid #e0ddd8',
              borderRadius: '8px',
            }}
            formatter={(value, name) => [Number(value).toLocaleString(), name]}
          />
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{
              paddingTop: '8px',
              fontSize: '11px',
              lineHeight: '1.6',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});
