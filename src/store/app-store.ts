// ============================================
// GLOBAL APPLICATION STATE (Zustand)
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useRef, useMemo, useDeferredValue } from 'react';

// Debounce timer for saves
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Helper to get default date range (1 year back from today)
function getDefaultDateRange(): { start: string; end: string } {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  return {
    start: oneYearAgo.toISOString().split('T')[0],
    end: today.toISOString().split('T')[0],
  };
}

// Helper to detect iOS devices (for PWA-specific optimizations)
function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent);
}

// Helper to create a fetch with timeout and abort signal
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 30000,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: signal || controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Helper to yield to browser for GC between large operations
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 100));
import {
  User,
  UserOrganization,
  StoreId,
  SalesRecord,
  BrandRecord,
  ProductRecord,
  CustomerRecord,
  BudtenderRecord,
  BrandMappingData,
  InvoiceLineItem,
  ResearchDocument,
  SEOSummary,
  QRCode,
} from '@/types';
import {
  normalizeBrandData,
  toCompatibleBrandRecords,
  NormalizedBrandRecord,
} from '@/lib/services/data-processor';
import {
  isCacheValid,
  loadFromCache,
  saveToCache,
  clearCache as clearCustomerCache,
} from '@/lib/services/customer-cache';
import { STORES } from '@/lib/config';

// AI Recommendation type (kept here since it's store-specific)
export interface AIRecommendation {
  id: string;
  type: string;
  date: string;
  analysis: string;
  summary?: string;
}

// Notification type for the notification center
export interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  actionLabel?: string;
  actionPage?: PageType;
  actionTab?: string;
}

// Navigation pages
export type PageType =
  | 'dashboard'
  | 'sales'
  | 'recommendations'
  | 'data-center'
  | 'research'
  | 'seo'
  | 'invoices'
  | 'settings';

interface AppState {
  // Authentication
  user: User | null;
  setUser: (user: User | null) => void;

  // Organization context
  currentOrganization: UserOrganization | null;
  setCurrentOrganization: (org: UserOrganization | null) => void;

  // Navigation
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;

  // Active tab within pages (for search navigation)
  activeTab: string | null;
  setActiveTab: (tab: string | null) => void;

  // Store filter
  selectedStore: StoreId;
  setSelectedStore: (store: StoreId) => void;

  // Date range filter
  dateRange: { start: string; end: string } | null;
  setDateRange: (range: { start: string; end: string } | null) => void;

  // Sales data
  salesData: SalesRecord[];
  setSalesData: (data: SalesRecord[]) => void;

  // Brand data
  brandData: BrandRecord[];
  setBrandData: (data: BrandRecord[]) => void;

  // Product data
  productData: ProductRecord[];
  setProductData: (data: ProductRecord[]) => void;

  // Customer data
  customerData: CustomerRecord[];
  setCustomerData: (data: CustomerRecord[]) => void;

  // Budtender data
  budtenderData: BudtenderRecord[];
  setBudtenderData: (data: BudtenderRecord[]) => void;

  // Brand mappings (v2 structure: canonical brand -> aliases -> product_type)
  brandMappings: BrandMappingData;
  setBrandMappings: (data: BrandMappingData) => void;

  // Invoice data
  invoiceData: InvoiceLineItem[];
  setInvoiceData: (data: InvoiceLineItem[]) => void;

  // Research data
  researchData: ResearchDocument[];
  setResearchData: (data: ResearchDocument[]) => void;

  // SEO data
  seoData: SEOSummary[];
  setSeoData: (data: SEOSummary[]) => void;

  // QR Codes data
  qrCodesData: QRCode[];
  setQrCodesData: (data: QRCode[]) => void;

  // AI Recommendations data
  aiRecommendations: AIRecommendation[];
  setAiRecommendations: (data: AIRecommendation[]) => void;
  addAiRecommendation: (recommendation: AIRecommendation) => void;

  // Permanent employee assignments (employee name -> store_id)
  permanentEmployees: Record<string, StoreId>;
  setPermanentEmployee: (employeeName: string, storeId: StoreId | null) => void;
  setPermanentEmployees: (employees: Record<string, StoreId>) => void;
  clearPermanentEmployees: () => void;
  saveBudtenderAssignments: () => Promise<void>;
  loadBudtenderAssignments: () => Promise<void>;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Loading overlay (for toast loading indicator)
  loadingOverlay: {
    visible: boolean;
    message: string;
    immediate: boolean;
  };
  showLoadingOverlay: (message?: string, immediate?: boolean) => void;
  hideLoadingOverlay: () => void;

  // Data loading status
  dataStatus: {
    sales: { loaded: boolean; count: number; lastUpdated?: string };
    brands: { loaded: boolean; count: number; lastUpdated?: string };
    products: { loaded: boolean; count: number; lastUpdated?: string };
    customers: { loaded: boolean; count: number; lastUpdated?: string };
    budtenders: { loaded: boolean; count: number; lastUpdated?: string };
    mappings: { loaded: boolean; count: number; lastUpdated?: string };
    invoices: { loaded: boolean; count: number; lastUpdated?: string };
    research: { loaded: boolean; count: number; lastUpdated?: string };
    seo: { loaded: boolean; count: number; lastUpdated?: string };
    qrCodes: { loaded: boolean; count: number; lastUpdated?: string };
    aiRecommendations: { loaded: boolean; count: number; lastUpdated?: string };
  };
  updateDataStatus: (
    type: keyof AppState['dataStatus'],
    status: Partial<AppState['dataStatus'][keyof AppState['dataStatus']]>
  ) => void;

  // Dark mode
  darkMode: boolean;
  toggleDarkMode: () => void;

  // Mobile sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Notifications
  notifications: AppNotification[];
  dismissedNotificationIds: string[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Reset all state
  reset: () => void;

  // Data loading
  dataHash: string | null;
  setDataHash: (hash: string | null) => void;
  loadData: () => Promise<void>;
  reloadCustomerData: () => Promise<void>;
}

const initialState = {
  user: null,
  currentOrganization: null as UserOrganization | null,
  currentPage: 'dashboard' as PageType,
  activeTab: null as string | null,
  selectedStore: 'combined' as StoreId,
  dateRange: getDefaultDateRange() as { start: string; end: string } | null,
  salesData: [] as SalesRecord[],
  brandData: [] as BrandRecord[],
  productData: [] as ProductRecord[],
  customerData: [] as CustomerRecord[],
  budtenderData: [] as BudtenderRecord[],
  brandMappings: {} as BrandMappingData,
  invoiceData: [] as InvoiceLineItem[],
  researchData: [] as ResearchDocument[],
  seoData: [] as SEOSummary[],
  qrCodesData: [] as QRCode[],
  aiRecommendations: [] as AIRecommendation[],
  permanentEmployees: {} as Record<string, StoreId>,
  isLoading: false,
  loadingOverlay: {
    visible: false,
    message: 'Loading...',
    immediate: false,
  },
  dataStatus: {
    sales: { loaded: false, count: 0 },
    brands: { loaded: false, count: 0 },
    products: { loaded: false, count: 0 },
    customers: { loaded: false, count: 0 },
    budtenders: { loaded: false, count: 0 },
    mappings: { loaded: false, count: 0 },
    invoices: { loaded: false, count: 0 },
    research: { loaded: false, count: 0 },
    seo: { loaded: false, count: 0 },
    qrCodes: { loaded: false, count: 0 },
    aiRecommendations: { loaded: false, count: 0 },
  },
  darkMode: false,
  sidebarOpen: false,
  dataHash: null as string | null,
  notifications: [] as AppNotification[],
  dismissedNotificationIds: [] as string[],
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setUser: (user) => set({ user }),

      setCurrentOrganization: (currentOrganization) => set({ currentOrganization }),

      setCurrentPage: (currentPage) => set({ currentPage }),

      setActiveTab: (activeTab) => set({ activeTab }),

      setSelectedStore: (selectedStore) => set({ selectedStore }),

      setDateRange: (dateRange) => set({ dateRange }),

      setSalesData: (salesData) =>
        set((state) => ({
          salesData,
          dataStatus: {
            ...state.dataStatus,
            sales: {
              loaded: true,
              count: salesData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setBrandData: (brandData) =>
        set((state) => ({
          brandData,
          dataStatus: {
            ...state.dataStatus,
            brands: {
              loaded: true,
              count: brandData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setProductData: (productData) =>
        set((state) => ({
          productData,
          dataStatus: {
            ...state.dataStatus,
            products: {
              loaded: true,
              count: productData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setCustomerData: (customerData) =>
        set((state) => ({
          customerData,
          dataStatus: {
            ...state.dataStatus,
            customers: {
              loaded: true,
              count: customerData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setBudtenderData: (budtenderData) =>
        set((state) => ({
          budtenderData,
          dataStatus: {
            ...state.dataStatus,
            budtenders: {
              loaded: true,
              count: budtenderData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setBrandMappings: (brandMappings) =>
        set((state) => ({
          brandMappings,
          dataStatus: {
            ...state.dataStatus,
            mappings: {
              loaded: true,
              count: Object.keys(brandMappings || {}).length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setInvoiceData: (invoiceData) =>
        set((state) => ({
          invoiceData,
          dataStatus: {
            ...state.dataStatus,
            invoices: {
              loaded: true,
              count: invoiceData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setResearchData: (researchData) =>
        set((state) => ({
          researchData,
          dataStatus: {
            ...state.dataStatus,
            research: {
              loaded: true,
              count: researchData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setSeoData: (seoData) =>
        set((state) => ({
          seoData,
          dataStatus: {
            ...state.dataStatus,
            seo: {
              loaded: true,
              count: seoData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setQrCodesData: (qrCodesData) =>
        set((state) => ({
          qrCodesData,
          dataStatus: {
            ...state.dataStatus,
            qrCodes: {
              loaded: true,
              count: qrCodesData.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      setAiRecommendations: (aiRecommendations) =>
        set((state) => ({
          aiRecommendations,
          dataStatus: {
            ...state.dataStatus,
            aiRecommendations: {
              loaded: true,
              count: aiRecommendations.length,
              lastUpdated: new Date().toISOString(),
            },
          },
        })),

      addAiRecommendation: (recommendation) =>
        set((state) => {
          const newRecommendations = [recommendation, ...state.aiRecommendations];
          return {
            aiRecommendations: newRecommendations,
            dataStatus: {
              ...state.dataStatus,
              aiRecommendations: {
                loaded: true,
                count: newRecommendations.length,
                lastUpdated: new Date().toISOString(),
              },
            },
          };
        }),

      setPermanentEmployee: (employeeName, storeId) => {
        set((state) => {
          const newEmployees = { ...state.permanentEmployees };
          if (storeId === null) {
            delete newEmployees[employeeName];
          } else {
            newEmployees[employeeName] = storeId;
          }
          return { permanentEmployees: newEmployees };
        });
        // Debounced auto-save (1 second delay to batch rapid changes)
        if (saveTimer) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
          useAppStore.getState().saveBudtenderAssignments();
          saveTimer = null;
        }, 1000);
      },

      setPermanentEmployees: (employees) => {
        set({ permanentEmployees: employees });
        // Save to Aurora immediately when batch setting employees
        useAppStore.getState().saveBudtenderAssignments();
      },

      clearPermanentEmployees: () => {
        set({ permanentEmployees: {} });
        // Save empty state to Aurora
        useAppStore.getState().saveBudtenderAssignments();
      },

      saveBudtenderAssignments: async () => {
        const { permanentEmployees } = useAppStore.getState();
        try {
          await fetch('/api/data/budtender-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments: permanentEmployees }),
          });
        } catch (error) {
          console.error('Error saving budtender assignments:', error);
        }
      },

      loadBudtenderAssignments: async () => {
        try {
          const response = await fetch('/api/data/budtender-assignments');
          if (!response.ok) {
            console.error('Failed to fetch budtender assignments:', response.status, response.statusText);
            return;
          }
          const result = await response.json();
          if (result.success && result.data?.assignments) {
            const auroraAssignments = result.data.assignments;
            const assignmentCount = Object.keys(auroraAssignments).length;

            // Always use Aurora data as source of truth
            if (assignmentCount > 0) {
              console.log(`Loaded ${assignmentCount} budtender assignments from Aurora`);
              set({ permanentEmployees: auroraAssignments });
            } else {
              // Aurora is empty - check if localStorage has data to sync
              const localAssignments = useAppStore.getState().permanentEmployees;
              if (Object.keys(localAssignments).length > 0) {
                console.log('Syncing localStorage assignments to Aurora...');
                await useAppStore.getState().saveBudtenderAssignments();
              }
            }
          } else {
            console.error('Invalid response from budtender assignments API:', result);
          }
        } catch (error) {
          console.error('Error loading budtender assignments:', error);
        }
      },

      setIsLoading: (isLoading) => set({ isLoading }),

      showLoadingOverlay: (message = 'Loading...', immediate = false) =>
        set({
          loadingOverlay: {
            visible: true,
            message,
            immediate,
          },
        }),

      hideLoadingOverlay: () =>
        set((state) => ({
          loadingOverlay: {
            ...state.loadingOverlay,
            visible: false,
          },
        })),

      updateDataStatus: (type, status) =>
        set((state) => ({
          dataStatus: {
            ...state.dataStatus,
            [type]: { ...state.dataStatus[type], ...status },
          },
        })),

      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      addNotification: (notification) =>
        set((state) => ({
          notifications: [
            {
              ...notification,
              id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              timestamp: new Date().toISOString(),
            },
            ...state.notifications,
          ],
        })),

      dismissNotification: (id) =>
        set((state) => ({
          dismissedNotificationIds: [...state.dismissedNotificationIds, id],
        })),

      clearAllNotifications: () =>
        set((state) => ({
          dismissedNotificationIds: [
            ...state.dismissedNotificationIds,
            ...state.notifications.map((n) => n.id),
          ],
        })),

      reset: () => set(initialState),

      setDataHash: (dataHash) => set({ dataHash }),

      loadData: async () => {
        // Get current date range for server-side filtering
        const { dateRange } = get();

        set({ isLoading: true });
        try {
          const params = new URLSearchParams();
          if (dateRange) {
            params.set('startDate', dateRange.start);
            params.set('endDate', dateRange.end);
          }

          // Load main data with date filtering (excludes customers and invoices)
          const response = await fetch(`/api/data/load?${params.toString()}`);
          const result = await response.json();

          if (result.success && result.data) {
            const { sales, brands, products, budtenders, brandMappings, dataHash, loadedAt } = result.data;

            const mappingsCount = brandMappings ? Object.keys(brandMappings).length : 0;

            // Yield to browser before heavy state update to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));

            set((state) => ({
              salesData: sales || [],
              brandData: brands || [],
              productData: products || [],
              budtenderData: budtenders || [],
              brandMappings: brandMappings || {},
              dataHash,
              dataStatus: {
                ...state.dataStatus,
                sales: { loaded: (sales?.length || 0) > 0, count: sales?.length || 0, lastUpdated: loadedAt },
                brands: { loaded: (brands?.length || 0) > 0, count: brands?.length || 0, lastUpdated: loadedAt },
                products: { loaded: (products?.length || 0) > 0, count: products?.length || 0, lastUpdated: loadedAt },
                budtenders: { loaded: (budtenders?.length || 0) > 0, count: budtenders?.length || 0, lastUpdated: loadedAt },
                mappings: { loaded: mappingsCount > 0, count: mappingsCount, lastUpdated: loadedAt },
              },
              // Keep isLoading true while background data loads
              isLoading: true,
            }));

            // Load budtender assignments (overrides localStorage - Aurora is source of truth)
            await useAppStore.getState().loadBudtenderAssignments();

            // Load customer data with smart caching
            // 1. Check IndexedDB cache first
            // 2. If cache is valid for requested date range, use it
            // 3. Otherwise fetch from server and update cache
            const loadCustomerPages = async () => {
              const { dateRange } = get();
              const startDate = dateRange?.start || '';
              const endDate = dateRange?.end || '';

              console.log(`Loading customers for date range: ${startDate} to ${endDate}`);

              // Check if we have valid cached data
              if (startDate && endDate) {
                try {
                  const { valid, metadata } = await isCacheValid(startDate, endDate);

                  if (valid && metadata) {
                    console.log(`Cache hit! Loading ${metadata.recordCount} customers from IndexedDB cache`);
                    const cachedCustomers = await loadFromCache();

                    if (cachedCustomers && cachedCustomers.length > 0) {
                      set((state) => ({
                        customerData: cachedCustomers,
                        dataStatus: {
                          ...state.dataStatus,
                          customers: {
                            loaded: true,
                            count: cachedCustomers.length,
                            lastUpdated: metadata.cachedAt,
                          },
                        },
                      }));
                      console.log(`Loaded ${cachedCustomers.length} customers from cache (instant)`);
                      return;
                    }
                  }
                } catch (cacheErr) {
                  console.warn('Cache check failed, falling back to server fetch:', cacheErr);
                }
              }

              // Cache miss or invalid - fetch from server
              console.log('Cache miss - fetching from server...');

              const isIOS = isIOSDevice();
              const pageSize = isIOS ? 10000 : 50000;
              const requestTimeout = isIOS ? 90000 : 120000;
              const dateParams = startDate && endDate
                ? `&startDate=${startDate}&endDate=${endDate}`
                : '';

              let allCustomers: CustomerRecord[] = [];
              let page = 1;
              let hasMore = true;
              let retryCount = 0;
              const maxRetries = 3;

              while (hasMore) {
                try {
                  const res = await fetchWithTimeout(
                    `/api/data/customers?page=${page}&pageSize=${pageSize}${dateParams}`,
                    requestTimeout
                  );
                  const result = await res.json();

                  if (result.success && result.data) {
                    allCustomers = [...allCustomers, ...result.data];
                    hasMore = result.pagination?.hasMore || false;
                    page++;
                    retryCount = 0;

                    set((state) => ({
                      customerData: allCustomers,
                      dataStatus: {
                        ...state.dataStatus,
                        customers: {
                          loaded: true,
                          count: result.pagination?.totalCount || allCustomers.length,
                          lastUpdated: new Date().toISOString(),
                        },
                      },
                    }));

                    if (hasMore) {
                      await yieldToBrowser();
                    }
                  } else {
                    hasMore = false;
                  }
                } catch (err) {
                  console.error(`Error loading customer page ${page}:`, err);

                  if (retryCount < maxRetries) {
                    retryCount++;
                    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
                    console.log(`Retrying customer page ${page} in ${backoffMs}ms (attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                  } else {
                    console.error(`Failed to load customer page ${page} after ${maxRetries} retries`);
                    hasMore = false;
                  }
                }
              }

              console.log(`Loaded ${allCustomers.length} customers in ${page - 1} pages from server`);

              // Save to IndexedDB cache for next time
              if (startDate && endDate && allCustomers.length > 0) {
                try {
                  await saveToCache(allCustomers, startDate, endDate);
                } catch (cacheErr) {
                  console.warn('Failed to save to cache:', cacheErr);
                }
              }
            };

            loadCustomerPages().catch(err => {
              console.error('Error loading customer data:', err);
            });

            // Load invoice data in pages (similar to customers - can be large dataset)
            const loadInvoicePages = async () => {
              // Use smaller page size on iOS to avoid memory pressure
              const isIOS = isIOSDevice();
              const pageSize = isIOS ? 2500 : 5000;
              const requestTimeout = isIOS ? 45000 : 30000;

              let allInvoices: InvoiceLineItem[] = [];
              let page = 1;
              let hasMore = true;
              let retryCount = 0;
              const maxRetries = 3;

              while (hasMore) {
                try {
                  const res = await fetchWithTimeout(
                    `/api/data/invoices?page=${page}&pageSize=${pageSize}`,
                    requestTimeout
                  );
                  const result = await res.json();

                  if (result.success && result.data) {
                    allInvoices = [...allInvoices, ...result.data];
                    hasMore = result.pagination?.hasMore || false;
                    page++;
                    retryCount = 0; // Reset retry count on success

                    // Update store with partial data as it loads
                    set((state) => ({
                      invoiceData: allInvoices,
                      dataStatus: {
                        ...state.dataStatus,
                        invoices: {
                          loaded: true,
                          count: result.pagination?.totalCount || allInvoices.length,
                          lastUpdated: new Date().toISOString(),
                        },
                      },
                    }));

                    // Yield to browser between pages to allow GC (especially important on iOS)
                    if (hasMore) {
                      await yieldToBrowser();
                    }
                  } else {
                    hasMore = false;
                  }
                } catch (err) {
                  console.error(`Error loading invoice page ${page}:`, err);

                  // Retry logic with exponential backoff
                  if (retryCount < maxRetries) {
                    retryCount++;
                    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
                    console.log(`Retrying invoice page ${page} in ${backoffMs}ms (attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                  } else {
                    console.error(`Failed to load invoice page ${page} after ${maxRetries} retries`);
                    hasMore = false;
                  }
                }
              }

              console.log(`Loaded ${allInvoices.length} invoices in ${page - 1} pages`);
            };

            loadInvoicePages().catch(err => {
              console.error('Error loading invoice data:', err);
            });

            // Load research, SEO, QR codes, and AI recommendations in background
            fetch('/api/data/research')
              .then(res => res.json())
              .then(researchResult => {
                if (researchResult.success && researchResult.data) {
                  const { research, seo, qrCodes, aiRecommendations } = researchResult.data;
                  set((state) => {
                    // Calculate total documents loaded
                    const totalDocuments =
                      state.dataStatus.sales.count +
                      state.dataStatus.brands.count +
                      state.dataStatus.products.count +
                      state.dataStatus.budtenders.count +
                      state.dataStatus.mappings.count +
                      state.dataStatus.customers.count +
                      state.dataStatus.invoices.count +
                      (research?.length || 0) +
                      (seo?.length || 0) +
                      (qrCodes?.length || 0) +
                      (aiRecommendations?.length || 0);

                    // Add success notification
                    const newNotification: AppNotification = {
                      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      type: 'success',
                      title: 'Data Refreshed!',
                      message: `${totalDocuments.toLocaleString()} documents loaded successfully.`,
                      timestamp: new Date().toISOString(),
                      actionLabel: 'View Details',
                      actionPage: 'data-center',
                    };

                    return {
                      researchData: research || [],
                      seoData: seo || [],
                      qrCodesData: qrCodes || [],
                      aiRecommendations: aiRecommendations || [],
                      dataStatus: {
                        ...state.dataStatus,
                        research: {
                          loaded: true,
                          count: research?.length || 0,
                          lastUpdated: new Date().toISOString(),
                        },
                        seo: {
                          loaded: true,
                          count: seo?.length || 0,
                          lastUpdated: new Date().toISOString(),
                        },
                        qrCodes: {
                          loaded: true,
                          count: qrCodes?.length || 0,
                          lastUpdated: new Date().toISOString(),
                        },
                        aiRecommendations: {
                          loaded: true,
                          count: aiRecommendations?.length || 0,
                          lastUpdated: new Date().toISOString(),
                        },
                      },
                      // Add the notification
                      notifications: [newNotification, ...state.notifications],
                      // Now all data is loaded, hide the toast
                      isLoading: false,
                      loadingOverlay: { visible: false, message: '', immediate: false },
                    };
                  });
                } else {
                  // Even on error, stop loading
                  set({ isLoading: false, loadingOverlay: { visible: false, message: '', immediate: false } });
                }
              })
              .catch(err => {
                console.error('Error loading research data:', err);
                set({ isLoading: false, loadingOverlay: { visible: false, message: '', immediate: false } });
              });
          } else {
            set({ isLoading: false, loadingOverlay: { visible: false, message: '', immediate: false } });
            console.error('Failed to load data:', result.error);
          }
        } catch (error) {
          set({ isLoading: false, loadingOverlay: { visible: false, message: '', immediate: false } });
          console.error('Error loading data:', error);
        }
      },

      // Reload customer data with current date range (called when date range changes)
      // Uses smart caching - checks IndexedDB first, then fetches from server if needed
      reloadCustomerData: async () => {
        const { dateRange } = get();
        const startDate = dateRange?.start || '';
        const endDate = dateRange?.end || '';

        console.log(`Reloading customers for date range: ${startDate} to ${endDate}`);

        // Check cache first
        if (startDate && endDate) {
          try {
            const { valid, metadata } = await isCacheValid(startDate, endDate);

            if (valid && metadata) {
              console.log(`Cache hit on reload! Loading ${metadata.recordCount} customers from cache`);
              const cachedCustomers = await loadFromCache();

              if (cachedCustomers && cachedCustomers.length > 0) {
                set((state) => ({
                  customerData: cachedCustomers,
                  dataStatus: {
                    ...state.dataStatus,
                    customers: {
                      loaded: true,
                      count: cachedCustomers.length,
                      lastUpdated: metadata.cachedAt,
                    },
                  },
                }));
                console.log(`Loaded ${cachedCustomers.length} customers from cache (instant)`);
                return;
              }
            }
          } catch (cacheErr) {
            console.warn('Cache check failed on reload:', cacheErr);
          }
        }

        // Cache miss - fetch from server
        console.log('Cache miss on reload - fetching from server...');

        const isIOS = isIOSDevice();
        const pageSize = isIOS ? 10000 : 50000;
        const requestTimeout = isIOS ? 90000 : 120000;
        const dateParams = startDate && endDate
          ? `&startDate=${startDate}&endDate=${endDate}`
          : '';

        let allCustomers: CustomerRecord[] = [];
        let page = 1;
        let hasMore = true;
        let retryCount = 0;
        const maxRetries = 3;

        // Clear existing data while loading
        set((state) => ({
          customerData: [],
          dataStatus: {
            ...state.dataStatus,
            customers: { ...state.dataStatus.customers, loaded: false },
          },
        }));

        while (hasMore) {
          try {
            const res = await fetchWithTimeout(
              `/api/data/customers?page=${page}&pageSize=${pageSize}${dateParams}`,
              requestTimeout
            );
            const result = await res.json();

            if (result.success && result.data) {
              allCustomers = [...allCustomers, ...result.data];
              hasMore = result.pagination?.hasMore || false;
              page++;
              retryCount = 0;

              set((state) => ({
                customerData: allCustomers,
                dataStatus: {
                  ...state.dataStatus,
                  customers: {
                    loaded: true,
                    count: result.pagination?.totalCount || allCustomers.length,
                    lastUpdated: new Date().toISOString(),
                  },
                },
              }));

              if (hasMore) {
                await yieldToBrowser();
              }
            } else {
              hasMore = false;
            }
          } catch (err) {
            console.error(`Error reloading customer page ${page}:`, err);
            if (retryCount < maxRetries) {
              retryCount++;
              const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
              hasMore = false;
            }
          }
        }

        console.log(`Reloaded ${allCustomers.length} customers in ${page - 1} pages from server`);

        // Save to cache for next time
        if (startDate && endDate && allCustomers.length > 0) {
          try {
            await saveToCache(allCustomers, startDate, endDate);
          } catch (cacheErr) {
            console.warn('Failed to save to cache on reload:', cacheErr);
          }
        }
      },
    }),
    {
      name: 'chapters-app-store',
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Record<string, unknown>;

        // Migration from version 0 (no version) to version 1
        // Ensure dateRange has a default value if null/undefined
        if (version === 0 || !state.dateRange) {
          state.dateRange = getDefaultDateRange();
        }

        return state;
      },
      partialize: (state) => ({
        user: state.user,
        currentOrganization: state.currentOrganization,
        selectedStore: state.selectedStore,
        dateRange: state.dateRange,
        darkMode: state.darkMode,
        permanentEmployees: state.permanentEmployees,
        notifications: state.notifications,
        dismissedNotificationIds: state.dismissedNotificationIds,
      }),
    }
  )
);

// Selectors for filtered data - use deferred values to prevent blocking UI
export const useFilteredSalesData = () => {
  const { salesData, selectedStore, dateRange } = useAppStore();
  // Defer the data so React can prioritize UI updates
  const deferredSalesData = useDeferredValue(salesData);

  return useMemo(() => {
    return deferredSalesData.filter((record) => {
      // Filter by store
      if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
        return false;
      }

      // Filter by date range
      if (dateRange) {
        const recordDate = new Date(record.date);
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        if (recordDate < startDate || recordDate > endDate) {
          return false;
        }
      }

      return true;
    });
  }, [deferredSalesData, selectedStore, dateRange]);
};

export const useFilteredBrandData = () => {
  const { brandData, selectedStore, dateRange } = useAppStore();
  const deferredBrandData = useDeferredValue(brandData);

  return useMemo(() => {
    return deferredBrandData.filter((record) => {
      if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
        return false;
      }
      // Filter by date range if brand has upload dates
      if (dateRange && record.upload_start_date && record.upload_end_date) {
        const brandStart = new Date(record.upload_start_date);
        const brandEnd = new Date(record.upload_end_date);
        const filterStart = new Date(dateRange.start);
        const filterEnd = new Date(dateRange.end);
        // Include if date ranges overlap
        if (brandEnd < filterStart || brandStart > filterEnd) {
          return false;
        }
      }
      return true;
    });
  }, [deferredBrandData, selectedStore, dateRange]);
};

// Get normalized brand data (consolidated by canonical brand name)
export const useNormalizedBrandData = (): NormalizedBrandRecord[] => {
  const { brandData, brandMappings, selectedStore, dateRange } = useAppStore();
  const deferredBrandData = useDeferredValue(brandData);

  return useMemo(() => {
    // First filter by store and date range
    const filtered = deferredBrandData.filter((record) => {
      if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
        return false;
      }
      // Filter by date range if brand has upload dates
      if (dateRange && record.upload_start_date && record.upload_end_date) {
        const brandStart = new Date(record.upload_start_date);
        const brandEnd = new Date(record.upload_end_date);
        const filterStart = new Date(dateRange.start);
        const filterEnd = new Date(dateRange.end);
        // Include if date ranges overlap
        if (brandEnd < filterStart || brandStart > filterEnd) {
          return false;
        }
      }
      return true;
    });

    // Then normalize using brand mappings
    return normalizeBrandData(filtered, brandMappings);
  }, [deferredBrandData, brandMappings, selectedStore, dateRange]);
};

// Get normalized brand data as BrandRecord[] for backward compatibility
export const useNormalizedBrandDataCompat = (): BrandRecord[] => {
  const normalized = useNormalizedBrandData();
  return useMemo(() => toCompatibleBrandRecords(normalized), [normalized]);
};

export const useFilteredProductData = () => {
  const { productData, selectedStore, dateRange } = useAppStore();
  const deferredProductData = useDeferredValue(productData);

  return useMemo(() => {
    return deferredProductData.filter((record) => {
      if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
        return false;
      }
      // Filter by date range - exclude records without dates when filtering
      if (dateRange) {
        // If record doesn't have upload dates, exclude it when date filtering is active
        if (!record.upload_start_date || !record.upload_end_date) {
          return false;
        }
        const productStart = new Date(record.upload_start_date);
        const productEnd = new Date(record.upload_end_date);
        const filterStart = new Date(dateRange.start);
        const filterEnd = new Date(dateRange.end);
        // Include if date ranges overlap
        if (productEnd < filterStart || productStart > filterEnd) {
          return false;
        }
      }
      return true;
    });
  }, [deferredProductData, selectedStore, dateRange]);
};

// Filtered budtender data by store and date range
// Only includes budtenders who have been assigned in permanentEmployees
export const useFilteredBudtenderData = () => {
  const { budtenderData, selectedStore, dateRange, permanentEmployees } = useAppStore();
  const deferredBudtenderData = useDeferredValue(budtenderData);

  return useMemo(() => {
    // Get list of assigned employee names for quick lookup
    const assignedEmployees = new Set(Object.keys(permanentEmployees));

    return deferredBudtenderData.filter((record) => {
      // Only include budtenders who have been assigned
      if (!assignedEmployees.has(record.employee_name)) {
        return false;
      }

      // Filter by store using permanent assignments
      if (selectedStore !== 'combined') {
        const assignedStore = permanentEmployees[record.employee_name];
        if (assignedStore !== selectedStore) {
          return false;
        }
      }

      // Filter by date range
      if (dateRange && record.date) {
        const recordDate = new Date(record.date);
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        if (recordDate < startDate || recordDate > endDate) {
          return false;
        }
      }
      return true;
    });
  }, [deferredBudtenderData, selectedStore, dateRange, permanentEmployees]);
};

// Filtered customer data by store only
// Note: Date filtering is now done server-side for performance (830k+ records)
export const useFilteredCustomerData = () => {
  const { customerData, selectedStore } = useAppStore();
  const deferredCustomerData = useDeferredValue(customerData);

  return useMemo(() => {
    return deferredCustomerData.filter((record) => {
      // Filter by store (customer has store_name, not store_id)
      // For now, include all customers when combined, or filter by store name match
      if (selectedStore !== 'combined') {
        const storeNameLower = record.store_name.toLowerCase();
        const storeConfig = STORES[selectedStore];
        if (storeConfig) {
          const nameWords = storeConfig.name.toLowerCase().split(/\s+/);
          if (!nameWords.some(word => word.length > 2 && storeNameLower.includes(word))) {
            return false;
          }
        }
      }
      return true;
    });
  }, [deferredCustomerData, selectedStore]);
};

// Hook to auto-load data when user is logged in
export const useAutoLoadData = () => {
  const { user, dataStatus, loadData, isLoading } = useAppStore();
  const hasLoaded = useRef(false);

  useEffect(() => {
    // Only load if user is logged in and we haven't loaded yet
    if (user && !hasLoaded.current && !isLoading && !dataStatus.sales.loaded) {
      hasLoaded.current = true;
      loadData();
    }
  }, [user, dataStatus.sales.loaded, loadData, isLoading]);

  // Reset when user logs out
  useEffect(() => {
    if (!user) {
      hasLoaded.current = false;
    }
  }, [user]);
};

// Hook to reload customer data when date range changes
// This is needed because customer data is filtered server-side for performance
export const useReloadCustomersOnDateChange = () => {
  const { dateRange, dataStatus, reloadCustomerData } = useAppStore();
  const previousDateRange = useRef<{ start: string; end: string } | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // Skip initial mount - data is already loaded with the initial date range
    if (isInitialMount.current) {
      isInitialMount.current = false;
      previousDateRange.current = dateRange;
      return;
    }

    // Only reload if date range actually changed and customers are already loaded
    const dateChanged = dateRange?.start !== previousDateRange.current?.start ||
                        dateRange?.end !== previousDateRange.current?.end;

    if (dateChanged && dataStatus.customers.loaded) {
      previousDateRange.current = dateRange;
      reloadCustomerData();
    }
  }, [dateRange, dataStatus.customers.loaded, reloadCustomerData]);
};
