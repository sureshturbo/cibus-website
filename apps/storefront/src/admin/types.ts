export interface Admin {
  id: number;
  email: string;
  fullName: string;
  lastLoginAt: string | null;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** Paginated list endpoints answer with this inside `data`. */
export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface DashboardSummary {
  orders: {
    total: number;
    byStatus: Record<string, number>;
    last7Days: number;
    pendingAction: number;
    awaitingFulfilment: number;
    deliveredToday: number;
  };
  revenue: {
    liveOrderValue: number;
    deliveredValue: number;
    last7DaysValue: number;
    averageOrderValue: number;
    currency: string;
    isCommittedRevenue: false;
  };
  catalogue: {
    totalProducts: number;
    activeProducts: number;
    featuredProducts: number;
    totalCategories: number;
    outOfStock: number;
  };
  offers: {
    active: number;
    scheduled: number;
    totalRedemptions: number;
    discountGiven: number;
  };
  fulfilment: {
    pending: number;
    confirmed: number;
    processing: number;
    ready: number;
    outForDelivery: number;
  };
  attention: {
    lowStockCount: number;
    newestEnquiries: number;
    lowStockItems: {
      id: number;
      name: string;
      sku: string;
      stockQuantity: number;
      lowStockThreshold: number;
      unitLabel: string;
    }[];
  };
  recentOrders: {
    id: number;
    orderNumber: string;
    customerName: string;
    status: string;
    total: number;
    createdAt: string;
  }[];
  generatedAt: string;
}

export interface AdminProductImage {
  id: number;
  url: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface AdminProduct {
  id: number;
  name: string;
  slug: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  isFeatured: boolean;
  unitLabel: string;
  shortDescription: string;
  description: string;
  categoryId: number;
  category: { id: number; name: string } | null;
  images: AdminProductImage[];
}

/**
 * Product create/edit payload. Money fields stay as major-unit strings
 * ("249.00"); the API converts to paise. `initialStock` is only sent on create.
 */
export interface ProductInput {
  name: string;
  slug?: string;
  categoryId: number;
  sku: string;
  unitLabel?: string;
  price: string;
  compareAtPrice?: string;
  lowStockThreshold?: number;
  initialStock?: number;
  shortDescription?: string;
  description?: string;
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface AdminOrder {
  id: number;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail: string;
  fulfilmentMethod: string;
  total: number;
  discountTotal: number;
  itemCount: number;
  createdAt: string;
}

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  parentId: number | null;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
  /** The API answers with a tree; children are populated for nodes that have any. */
  children?: AdminCategory[];
}

export interface CategoryInput {
  name: string;
  slug?: string;
  parentId?: number | null;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface Enquiry {
  id: number;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  message: string;
  status: string;
  notes: string | null;
  createdAt: string;
}