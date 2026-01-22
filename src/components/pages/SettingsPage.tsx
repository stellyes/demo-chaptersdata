'use client';

import { useState } from 'react';
import { Download, Shield, ChevronLeft } from 'lucide-react';
import { Header } from '@/components/ui/Header';
import { Card } from '@/components/ui/Card';
import { useAppStore } from '@/store/app-store';
import { useProfile } from '@/hooks/useProfile';
import { useDisplayName } from '@/hooks/useDisplayName';

export function SettingsPage() {
  const { user, setCurrentPage } = useAppStore();
  const { profile, isLoading, isSaving, hasChanges, updateField, saveProfile, resetChanges } = useProfile(user?.userId);
  const { saveDisplayName } = useDisplayName(user?.userId);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleSave = async () => {
    setSaveMessage(null);
    const result = await saveProfile();
    if (result.success) {
      // Also update the display name hook to keep sidebar in sync
      if (profile.displayName) {
        saveDisplayName(profile.displayName);
      }
      if (result.savedToCloud) {
        setSaveMessage({ type: 'success', text: 'Profile saved to cloud successfully!' });
      } else {
        setSaveMessage({ type: 'success', text: 'Profile saved locally. Cloud sync unavailable.' });
      }
      setTimeout(() => setSaveMessage(null), 5000);
    } else {
      setSaveMessage({ type: 'error', text: 'Failed to save profile. Please try again.' });
    }
  };

  // Export profile data as JSON
  const handleExportProfileJSON = async () => {
    setIsExporting(true);
    try {
      const exportData = {
        user: {
          email: user?.email || user?.username || '',
          accountType: user?.isGlobalAdmin ? 'Admin Account' : 'Client Account',
        },
        profile: {
          displayName: profile.displayName,
          organizationName: profile.organizationName,
          organizationType: profile.organizationType,
          licenseNumber: profile.licenseNumber,
          address: profile.address,
          city: profile.city,
          state: profile.state,
          zipCode: profile.zipCode,
          phone: profile.phone,
        },
        exportedAt: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chapters-profile-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  // Export profile data as CSV
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const headers = ['Field', 'Value'];
      const rows = [
        ['Display Name', profile.displayName],
        ['Email', user?.email || user?.username || ''],
        ['Account Type', user?.isGlobalAdmin ? 'Admin Account' : 'Client Account'],
        ['Organization Name', profile.organizationName],
        ['Organization Type', profile.organizationType],
        ['License Number', profile.licenseNumber],
        ['Address', profile.address],
        ['City', profile.city],
        ['State', profile.state],
        ['ZIP Code', profile.zipCode],
        ['Phone', profile.phone],
        ['Exported At', new Date().toISOString()],
      ];

      const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chapters-profile-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <Header title="Profile Settings" subtitle="Settings" />
        <div className="flex items-center justify-center py-12">
          <p className="text-[var(--muted)]">Loading profile...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Profile Settings" subtitle="Settings" />

      {/* Back Button */}
      <button
        onClick={() => setCurrentPage('dashboard')}
        className="flex items-center gap-2 mb-6 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      {/* Save Message */}
      {saveMessage && (
        <div className={`mb-6 p-4 rounded-lg ${
          saveMessage.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {saveMessage.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Personal Information */}
        <Card>
          <h3 className="font-serif text-xl font-medium text-[var(--ink)] mb-4">Personal Information</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-[var(--ink)] mb-1">
                Display Name
              </label>
              <input
                type="text"
                id="displayName"
                value={profile.displayName}
                onChange={(e) => updateField('displayName', e.target.value)}
                placeholder="How should we address you?"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                This name appears in the sidebar and throughout the app
              </p>
            </div>
          </div>
        </Card>

        {/* Account Information */}
        <Card>
          <h3 className="font-serif text-xl font-medium text-[var(--ink)] mb-4">Account Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">Email</label>
              <input
                type="text"
                value={user?.email || user?.username || ''}
                disabled
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--cream)] text-[var(--muted)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">Account Type</label>
              <input
                type="text"
                value={user?.isGlobalAdmin ? 'Admin Account' : 'Client Account'}
                disabled
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--cream)] text-[var(--muted)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">Account Status</label>
              <div className="px-3 py-2 border border-green-200 rounded bg-green-50 text-green-700 text-sm font-medium">
                Active
              </div>
            </div>
          </div>
        </Card>

        {/* Organization Information */}
        <Card>
          <h3 className="font-serif text-xl font-medium text-[var(--ink)] mb-4">Organization Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="organizationName" className="block text-sm font-medium text-[var(--ink)] mb-1">
                Organization Name
              </label>
              <input
                type="text"
                id="organizationName"
                value={profile.organizationName}
                onChange={(e) => updateField('organizationName', e.target.value)}
                placeholder="Enter your organization name"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="organizationType" className="block text-sm font-medium text-[var(--ink)] mb-1">
                Organization Type
              </label>
              <select
                id="organizationType"
                value={profile.organizationType}
                onChange={(e) => updateField('organizationType', e.target.value)}
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              >
                <option value="">Select organization type</option>
                <option value="service">Service Business</option>
                <option value="retail">Retail Store</option>
                <option value="distributor">Distributor</option>
                <option value="manufacturer">Manufacturer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="licenseNumber" className="block text-sm font-medium text-[var(--ink)] mb-1">
                License #
              </label>
              <input
                type="text"
                id="licenseNumber"
                value={profile.licenseNumber}
                onChange={(e) => updateField('licenseNumber', e.target.value)}
                placeholder="License number"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="address" className="block text-sm font-medium text-[var(--ink)] mb-1">
                Organization Address
              </label>
              <input
                type="text"
                id="address"
                value={profile.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="Street address"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-[var(--ink)] mb-1">City</label>
              <input
                type="text"
                id="city"
                value={profile.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="City"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-[var(--ink)] mb-1">State</label>
              <input
                type="text"
                id="state"
                value={profile.state}
                onChange={(e) => updateField('state', e.target.value)}
                placeholder="State"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="zipCode" className="block text-sm font-medium text-[var(--ink)] mb-1">ZIP Code</label>
              <input
                type="text"
                id="zipCode"
                value={profile.zipCode}
                onChange={(e) => updateField('zipCode', e.target.value)}
                placeholder="ZIP"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-[var(--ink)] mb-1">Phone</label>
              <input
                type="tel"
                id="phone"
                value={profile.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="(555) 555-5555"
                className="w-full px-3 py-2 border border-[var(--border)] rounded bg-[var(--white)] text-[var(--ink)] text-sm"
              />
            </div>
          </div>

          {/* Save/Cancel Actions */}
          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-[var(--border)]">
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                hasChanges && !isSaving
                  ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-light)]'
                  : 'bg-[var(--border)] text-[var(--muted)] cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            {hasChanges && (
              <button
                onClick={resetChanges}
                disabled={isSaving}
                className="px-4 py-2 rounded border border-[var(--border)] text-sm font-medium text-[var(--ink)] hover:bg-[var(--cream)] transition-colors"
              >
                Cancel
              </button>
            )}
            {!hasChanges && <span className="text-sm text-[var(--muted)]">No unsaved changes</span>}
          </div>
        </Card>

        {/* Data Export */}
        <Card>
          <h3 className="font-serif text-xl font-medium text-[var(--ink)] mb-2">Data Export</h3>
          <p className="text-sm text-[var(--muted)] mb-4">
            Export your profile and organization data for your records.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleExportProfileJSON}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 rounded border border-[var(--border)] text-sm font-medium text-[var(--ink)] hover:bg-[var(--cream)] transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Profile JSON
            </button>
            <button
              onClick={handleExportCSV}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 rounded border border-[var(--border)] text-sm font-medium text-[var(--ink)] hover:bg-[var(--cream)] transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Profile CSV
            </button>
          </div>
        </Card>

        {/* Security */}
        <Card>
          <h3 className="font-serif text-xl font-medium text-[var(--ink)] mb-4">Security</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-[var(--border)] rounded">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-[var(--muted)]" />
                <div>
                  <h4 className="text-sm font-medium text-[var(--ink)]">Change Password</h4>
                  <p className="text-xs text-[var(--muted)]">Update your account password</p>
                </div>
              </div>
              <button
                disabled
                className="px-4 py-2 rounded border border-[var(--border)] text-sm font-medium text-[var(--muted)] cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>
            <div className="flex items-center justify-between p-4 border border-[var(--border)] rounded">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-[var(--muted)]" />
                <div>
                  <h4 className="text-sm font-medium text-[var(--ink)]">Two-Factor Authentication</h4>
                  <p className="text-xs text-[var(--muted)]">Add an extra layer of security to your account</p>
                </div>
              </div>
              <button
                disabled
                className="px-4 py-2 rounded border border-[var(--border)] text-sm font-medium text-[var(--muted)] cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
