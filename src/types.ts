/** Values accepted by Google Merchant Center for `availability`. */
export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder';

/** Values accepted for `condition`. Google requires them in English. */
export type Condition = 'new' | 'refurbished' | 'used';

/** An amount in a currency, rendered as `"1299.90 TRY"`. */
export interface Money {
  amount: number;
  /** ISO 4217 code, e.g. "TRY", "USD", "EUR". */
  currency: string;
}

export interface Shipping {
  /** ISO 3166-1 alpha-2, e.g. "TR". */
  country: string;
  /** Service class, e.g. "Standart" or "Express". */
  service?: string;
  price?: Money;
}

/**
 * A product in a channel-neutral shape. Field names follow Google's product data specification in camelCase, so
 * mapping to the feed is one-to-one.
 */
export interface Product {
  /** Your stable SKU or product ID. Max 50 characters. Never reuse it for a different product. */
  id: string;
  /** Max 150 characters. */
  title: string;
  /** Plain text, max 5000 characters. */
  description: string;
  /** Product page URL (http or https). */
  link: string;
  /** Main image URL (http or https). */
  imageLink: string;
  additionalImageLinks?: string[];
  availability: Availability;
  /** Required when availability is `preorder`. */
  availabilityDate?: Date | string;
  /** The regular price. Put discounts in `salePrice`, not here. */
  price: Money;
  salePrice?: Money;
  salePriceEffectiveDate?: { start: Date | string; end: Date | string };
  brand?: string;
  /** EAN-13 / UPC-12 / ITF-14 / GTIN-8 with a valid check digit. Never invent one. */
  gtin?: string;
  /** Manufacturer part number. Use it when the product has no GTIN. */
  mpn?: string;
  /** `false` for products without a GTIN or MPN, e.g. handmade or private-label items. */
  identifierExists?: boolean;
  condition?: Condition;
  /** Shared by all variants (sizes, colours) of the same product. */
  itemGroupId?: string;
  /** Google taxonomy ID or full path, e.g. "Apparel & Accessories > Clothing". */
  googleProductCategory?: string;
  /** Your own category path, e.g. "Kadın > Elbise". */
  productType?: string;
  color?: string;
  size?: string;
  gender?: 'male' | 'female' | 'unisex';
  ageGroup?: 'newborn' | 'infant' | 'toddler' | 'kids' | 'adult';
  shipping?: Shipping[];
  /** Up to five labels for campaign segmentation (custom_label_0 … custom_label_4). */
  customLabels?: string[];
}

/** The `<channel>` header of the feed. */
export interface FeedChannel {
  title: string;
  link: string;
  description: string;
}

export interface Issue {
  productId: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}
