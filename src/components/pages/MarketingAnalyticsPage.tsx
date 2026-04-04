'use client';

import { memo } from 'react';
import { Header } from '@/components/ui/Header';
import { Tabs } from '@/components/ui/Tabs';
import { EventGeofencingTab } from '@/components/marketing/EventGeofencingTab';
import { QRPortalTab } from '@/components/pages/QRCodePage';
import { SEOAnalysisTab } from '@/components/pages/DataCenterPage';
import { CustomerAnalyticsTab } from '@/components/pages/SalesAnalyticsPage';

export const MarketingAnalyticsPage = memo(function MarketingAnalyticsPage() {
  const tabs = [
    {
      id: 'geofencing',
      label: 'Event Geofencing',
      render: () => <EventGeofencingTab />,
    },
    {
      id: 'qr-portal',
      label: 'QR Portal',
      render: () => <QRPortalTab />,
    },
    {
      id: 'seo',
      label: 'SEO Analysis',
      render: () => <SEOAnalysisTab />,
    },
    {
      id: 'customers',
      label: 'Customer Analytics',
      render: () => <CustomerAnalyticsTab />,
    },
  ];

  return (
    <div>
      <Header title="Marketing Intelligence" subtitle="Marketing" />
      <Tabs tabs={tabs} />
    </div>
  );
});
