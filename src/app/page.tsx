// Force dynamic rendering to prevent stale SSR cache (s-maxage=31536000).
// This page depends on client-side auth state and must always serve fresh HTML
// so that JavaScript chunk references stay current across deployments.
export const dynamic = 'force-dynamic';

import AppClient from './AppClient';

export default function Page() {
  return <AppClient />;
}
