// ============================================
// GLOBAL APPLICATION STATE (Zustand)
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useRef } from 'react';
import {
  User,
  StoreId,
  SalesRecord,
  BrandRecord,
  ProductRecord,
  CustomerRecord,
  BudtenderRecord,
  BrandMapping,
  InvoiceLineItem,
} from '@/types';

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

  // Navigation
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;

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

  // Brand mappings
  brandMappings: BrandMapping[];
  setBrandMappings: (data: BrandMapping[]) => void;

  // Invoice data
  invoiceData: InvoiceLineItem[];
  setInvoiceData: (data: InvoiceLineItem[]) => void;

  // Permanent employee assignments (employee name -> store_id)
  permanentEmployees: Record<string, StoreId>;
  setPermanentEmployee: (employeeName: string, storeId: StoreId | null) => void;
  clearPermanentEmployees: () => void;

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
  };
  updateDataStatus: (
    type: keyof AppState['dataStatus'],
    status: Partial<AppState['dataStatus'][keyof AppState['dataStatus']]>
  ) => void;

  // Dark mode
  darkMode: boolean;
  toggleDarkMode: () => void;

  // Reset all state
  reset: () => void;

  // Data loading
  dataHash: string | null;
  setDataHash: (hash: string | null) => void;
  loadDataFromS3: () => Promise<void>;
}

const initialState = {
  user: null,
  currentPage: 'dashboard' as PageType,
  selectedStore: 'combined' as StoreId,
  dateRange: null,
  salesData: [] as SalesRecord[],
  brandData: [] as BrandRecord[],
  productData: [] as ProductRecord[],
  customerData: [] as CustomerRecord[],
  budtenderData: [] as BudtenderRecord[],
  brandMappings: [] as BrandMapping[],
  invoiceData: [] as InvoiceLineItem[],
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
  },
  darkMode: false,
  dataHash: null as string | null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,

      setUser: (user) => set({ user }),

      setCurrentPage: (currentPage) => set({ currentPage }),

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
              count: brandMappings.length,
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

      setPermanentEmployee: (employeeName, storeId) =>
        set((state) => {
          const newEmployees = { ...state.permanentEmployees };
          if (storeId === null) {
            delete newEmployees[employeeName];
          } else {
            newEmployees[employeeName] = storeId;
          }
          return { permanentEmployees: newEmployees };
        }),

      clearPermanentEmployees: () => set({ permanentEmployees: {} }),

      setIsLoading: (isLoading) => set({ isLoading }),

      updateDataStatus: (type, status) =>
        set((state) => ({
          dataStatus: {
            ...state.dataStatus,
            [type]: { ...state.dataStatus[type], ...status },
          },
        })),

      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

      reset: () => set(initialState),

      setDataHash: (dataHash) => set({ dataHash }),

      loadDataFromS3: async () => {
        set({ isLoading: true });
        try {
          // Load main data (fast - S3 only)
          const response = await fetch('/api/data/load');
          const result = await response.json();

          if (result.success && result.data) {
            const { sales, brands, products, customers, budtenders, mappings, dataHash, loadedAt } = result.data;

            set((state) => ({
              salesData: sales || [],
              brandData: brands || [],
              productData: products || [],
              customerData: customers || [],
              budtenderData: budtenders || [],
              brandMappings: mappings || [],
              dataHash,
              dataStatus: {
                ...state.dataStatus,
                sales: { loaded: (sales?.length || 0) > 0, count: sales?.length || 0, lastUpdated: loadedAt },
                brands: { loaded: (brands?.length || 0) > 0, count: brands?.length || 0, lastUpdated: loadedAt },
                products: { loaded: (products?.length || 0) > 0, count: products?.length || 0, lastUpdated: loadedAt },
                customers: { loaded: (customers?.length || 0) > 0, count: customers?.length || 0, lastUpdated: loadedAt },
                budtenders: { loaded: (budtenders?.length || 0) > 0, count: budtenders?.length || 0, lastUpdated: loadedAt },
                mappings: { loaded: (mappings?.length || 0) > 0, count: mappings?.length || 0, lastUpdated: loadedAt },
              },
              // Keep isLoading true while invoice data loads in background
              isLoading: true,
            }));

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
                    // Now all data is loaded, hide the toast
                    isLoading: false,
                  }));
                } else {
                  // Even on error, stop loading
                  set({ isLoading: false });
                }
              })
              .catch(err => {
                console.error('Error loading invoice data:', err);
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
        selectedStore: state.selectedStore,
        dateRange: state.dateRange,
        darkMode: state.darkMode,
        permanentEmployees: state.permanentEmployees,
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
