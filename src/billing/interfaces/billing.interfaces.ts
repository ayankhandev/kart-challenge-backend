export interface BillingInput {
  items: { productId: string; quantity: number }[];
  couponCode?: string;
}

export interface BillingLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface BillingBreakdown {
  items: BillingLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountRate: number;
  discountAmount: number;
  total: number;
  couponCode: string | null;
}
