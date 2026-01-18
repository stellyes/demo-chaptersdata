// ============================================
// GLOBAL APPLICATION STATE (Zustand)
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useRef, useMemo } from 'react';

// Debounce timer for S3 saves
let saveToS3Timer: ReturnType<typeof setTimeout> | null = null;
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
  | 'qr-codes';

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
  saveBudtenderAssignmentsToS3: () => Promise<void>;
  loadBudtenderAssignmentsFromS3: () => Promise<void>;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

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
  loadDataFromS3: () => Promise<void>;
}

const initialState = {
  user: null,
  currentOrganization: null as UserOrganization | null,
  currentPage: 'dashboard' as PageType,
  activeTab: null as string | null,
  selectedStore: 'combined' as StoreId,
  dateRange: null,
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
    (set) => ({
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
        // Debounced auto-save to S3 (1 second delay to batch rapid changes)
        if (saveToS3Timer) {
          clearTimeout(saveToS3Timer);
        }
        saveToS3Timer = setTimeout(() => {
          useAppStore.getState().saveBudtenderAssignmentsToS3();
          saveToS3Timer = null;
        }, 1000);
      },

      setPermanentEmployees: (employees) => {
        set({ permanentEmployees: employees });
        // Save to S3 immediately when batch setting employees
        useAppStore.getState().saveBudtenderAssignmentsToS3();
      },

      clearPermanentEmployees: () => {
        set({ permanentEmployees: {} });
        // Save empty state to S3
        useAppStore.getState().saveBudtenderAssignmentsToS3();
      },

      saveBudtenderAssignmentsToS3: async () => {
        const { permanentEmployees } = useAppStore.getState();
        try {
          await fetch('/api/data/budtender-assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments: permanentEmployees }),
          });
        } catch (error) {
          console.error('Error saving budtender assignments to S3:', error);
        }
      },

      loadBudtenderAssignmentsFromS3: async () => {
        try {
          const response = await fetch('/api/data/budtender-assignments');
          const result = await response.json();
          if (result.success && result.data?.assignments) {
            set({ permanentEmployees: result.data.assignments });
          }
        } catch (error) {
          console.error('Error loading budtender assignments from S3:', error);
        }
      },

      setIsLoading: (isLoading) => set({ isLoading }),

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

      loadDataFromS3: async () => {
        set({ isLoading: true });
        try {
          // Load main data (fast - S3 only, excludes customers and invoices)
          const response = await fetch('/api/data/load');
          const result = await response.json();

          if (result.success && result.data) {
            const { sales, brands, products, budtenders, brandMappings, dataHash, loadedAt } = result.data;

            const mappingsCount = brandMappings ? Object.keys(brandMappings).length : 0;

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

            // Load budtender assignments from S3 (overrides localStorage if newer)
            useAppStore.getState().loadBudtenderAssignmentsFromS3();

            // Load customer data separately in background (large dataset ~30MB CSV)
            fetch('/api/data/customers?pageSize=50000')
              .then(res => res.json())
              .then(customerResult => {
                if (customerResult.success) {
                  set((state) => ({
                    customerData: customerResult.data || [],
                    dataStatus: {
                      ...state.dataStatus,
                      customers: {
                        loaded: (customerResult.data?.length || 0) > 0,
                        count: customerResult.pagination?.totalCount || customerResult.data?.length || 0,
                        lastUpdated: new Date().toISOString(),
                      },
                    },
                  }));
                }
              })
              .catch(err => {
                console.error('Error loading customer data:', err);
              });

            // Load invoice data separately in background (slow - DynamoDB)
            fetch('/api/data/invoices')
              .then(res => res.json())
              .then(invoiceResult => {
                if (invoiceResult.success) {
                  set((state) => ({
                    invoiceData: invoiceResult.data || [],
                    dataStatus: {
                      ...state.dataStatus,
                      invoices: {
                        loaded: (invoiceResult.data?.length || 0) > 0,
                        count: invoiceResult.data?.length || 0,
                        lastUpdated: new Date().toISOString(),
                      },
                    },
                  }));
                }
              })
              .catch(err => {
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
                    };
                  });
                } else {
                  // Even on error, stop loading
                  set({ isLoading: false });
                }
              })
              .catch(err => {
                console.error('Error loading research data:', err);
                set({ isLoading: false });
              });
          } else {
            set({ isLoading: false });
            console.error('Failed to load data:', result.error);
          }
        } catch (error) {
          set({ isLoading: false });
          console.error('Error loading data from S3:', error);
        }
      },
    }),
    {
      name: 'chapters-app-store',
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

// Selectors for filtered data
export const useFilteredSalesData = () => {
  const { salesData, selectedStore, dateRange } = useAppStore();

  return salesData.filter((record) => {
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
};

export const useFilteredBrandData = () => {
  const { brandData, selectedStore } = useAppStore();

  return brandData.filter((record) => {
    if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
      return false;
    }
    return true;
  });
};

// Get normalized brand data (consolidated by canonical brand name)
export const useNormalizedBrandData = (): NormalizedBrandRecord[] => {
  const { brandData, brandMappings, selectedStore } = useAppStore();

  return useMemo(() => {
    // First filter by store
    const filtered = brandData.filter((record) => {
      if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
        return false;
      }
      return true;
    });

    // Then normalize using brand mappings
    return normalizeBrandData(filtered, brandMappings);
  }, [brandData, brandMappings, selectedStore]);
};

// Get normalized brand data as BrandRecord[] for backward compatibility
export const useNormalizedBrandDataCompat = (): BrandRecord[] => {
  const normalized = useNormalizedBrandData();
  return useMemo(() => toCompatibleBrandRecords(normalized), [normalized]);
};

export const useFilteredProductData = () => {
  const { productData, selectedStore } = useAppStore();

  return productData.filter((record) => {
    if (selectedStore !== 'combined' && record.store_id !== selectedStore) {
      return false;
    }
    return true;
  });
};

// Hook to auto-load data from S3 when user is logged in
export const useAutoLoadData = () => {
  const { user, dataStatus, loadDataFromS3, isLoading } = useAppStore();
  const hasLoaded = useRef(false);

  useEffect(() => {
    // Only load if user is logged in and we haven't loaded yet
    if (user && !hasLoaded.current && !isLoading && !dataStatus.sales.loaded) {
      hasLoaded.current = true;
      loadDataFromS3();
    }
  }, [user, dataStatus.sales.loaded, loadDataFromS3, isLoading]);

  // Reset when user logs out
  useEffect(() => {
    if (!user) {
      hasLoaded.current = false;
    }
  }, [user]);
};
