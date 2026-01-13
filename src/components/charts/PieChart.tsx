'use client';

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

export function CategoryPieChart({ data, showLegend = true }: CategoryPieChartProps) {
  // Truncate long names for display
  const truncateName = (name: string, maxLength: number = 15) => {
    return name.length > maxLength ? name.slice(0, maxLength) + '...' : name;
  };

  return (
    <ResponsiveContainer width="100%" height={showLegend ? 380 : 300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy={showLegend ? "40%" : "50%"}
          innerRadius={50}
          outerRadius={80}
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
            wrapperStyle={{ paddingTop: '20px' }}
            formatter={(value) => <span style={{ color: '#333', fontSize: '12px' }}>{truncateName(String(value))}</span>}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}

interface SegmentPieChartProps {
  data: Record<string, number>;
  title?: string;
}

export function SegmentPieChart({ data }: SegmentPieChartProps) {
  const chartData = Object.entries(data).map(([name, value]) => ({
    name,
    value,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
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
          formatter={(value, name) => [value, name]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
