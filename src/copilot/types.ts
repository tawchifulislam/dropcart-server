export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  image?: string;
  category: string;
  price: number;
  basePrice: number;
  status: 'live' | 'upcoming' | 'no_drop' | 'sold_out';
  stockRemaining?: number;
  dropId?: string;
}

export interface CopilotAction {
  type: 'added_to_cart';
  productId: string;
  name: string;
  quantity: number;
}
