import { XMLParser } from 'fast-xml-parser';
import type { Availability, Issue, Product } from './types.js';
import { validateProduct } from './validate.js';

/** A parsed XML element: attributes are prefixed with `@_`, text content is under `#text` when mixed with attributes. */
export type XmlNode = Record<string, unknown>;

/** A dotted path into a supplier item ("Fiyat", "Resimler.Resim", "@_kod"), or a function for anything custom. */
export type FieldSource<T> = string | ((item: XmlNode) => T | undefined);

export interface SupplierMapping {
  /** Dotted path to the repeating product element, e.g. "Urunler.Urun" or "products.product". */
  items: string;
  fields: {
    id: FieldSource<string>;
    title: FieldSource<string>;
    description?: FieldSource<string>;
    link: FieldSource<string>;
    imageLink: FieldSource<string>;
    additionalImageLinks?: FieldSource<string[]>;
    /** Number or a localized string like "1.299,90". */
    price: FieldSource<string | number>;
    salePrice?: FieldSource<string | number>;
    /** Stock quantity; converted to availability with {@link stockToAvailability}. */
    stock?: FieldSource<string | number>;
    availability?: FieldSource<Availability>;
    brand?: FieldSource<string>;
    gtin?: FieldSource<string>;
    mpn?: FieldSource<string>;
    productType?: FieldSource<string>;
    itemGroupId?: FieldSource<string>;
    color?: FieldSource<string>;
    size?: FieldSource<string>;
  };
  /** ISO 4217 currency of the supplier's prices. Default "TRY". */
  currency?: string;
  /**
   * The supplier's decimal mark. Set it when prices may look like "1.250" (Turkish 1250); without it such values are
   * reported as unreadable instead of guessed.
   */
  decimalSeparator?: ',' | '.';
  /** Applied to every product before mapping fields, e.g. `{ condition: 'new', shipping: [...] }`. */
  defaults?: Partial<Product>;
  /** Last chance to adjust a mapped product (add a margin, rewrite URLs…). Return `null` to drop it. */
  transform?: (product: Product, item: XmlNode) => Product | null;
}

export interface ImportResult {
  products: Product[];
  /** Validation issues for mapped products plus items that could not be mapped at all. */
  issues: Issue[];
}

/**
 * Parse a price written the Turkish/European way ("1.299,90"), the English way ("1,299.90") or plainly ("1299.9").
 * Currency symbols and "TL"/"TRY" are ignored.
 *
 * Without `decimalSeparator`, ambiguous input is rejected (`NaN`) rather than guessed: "1.250" is 1250 in a Turkish
 * catalogue and 1.25 in an English one, and guessing wrong publishes a price off by a factor of 1000. Pass the
 * supplier's convention to read such values.
 */
export function parseLocalizedNumber(input: string | number, decimalSeparator?: ',' | '.'): number {
  if (typeof input === 'number') return input;
  let s = input.replace(/[\s ₺$€£]|TL|TRY/gi, '');
  if (decimalSeparator) {
    const thousands = decimalSeparator === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimalSeparator, '.');
  } else {
    const commas = s.split(',').length - 1;
    const dots = s.split('.').length - 1;
    if (commas && dots) {
      // Both present: whichever comes last is the decimal mark.
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (commas + dots === 1) {
      // A single separator followed by exactly three digits could be either. Refuse to guess.
      if (/^-?\d{1,3}[.,]\d{3}$/.test(s)) return Number.NaN;
      s = s.replace(',', '.');
    } else if (commas + dots > 1) {
      // Repeated separator ("1.299.000", "1,299,000") can only be thousands grouping.
      if (!/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return Number.NaN;
      s = s.replace(/[.,]/g, '');
    }
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/** 0 or less → out_of_stock, anything positive → in_stock. Non-numeric stock is treated as out of stock. */
export function stockToAvailability(stock: string | number | undefined): Availability {
  const qty = stock === undefined ? 0 : parseLocalizedNumber(stock);
  return Number.isFinite(qty) && qty > 0 ? 'in_stock' : 'out_of_stock';
}

function get(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => (cur && typeof cur === 'object' ? (cur as XmlNode)[key] : undefined), node);
}

function read<T>(item: XmlNode, source: FieldSource<T> | undefined): T | undefined {
  if (source === undefined) return undefined;
  if (typeof source === 'function') return source(item);
  const value = get(item, source);
  if (value && typeof value === 'object' && '#text' in value) return (value as XmlNode)['#text'] as T;
  return value as T | undefined;
}

const asText = (v: unknown) => (v === undefined || v === null ? undefined : String(v).trim() || undefined);

/**
 * Turn a supplier/dealer XML catalogue (tedarikçi / bayi XML) into validated {@link Product}s using a field mapping.
 * Values stay strings until mapped, so barcodes keep their leading zeros. External entities are never resolved.
 */
export function importSupplierXml(xml: string, mapping: SupplierMapping): ImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false, // keep "0012345678905" as a string
    parseAttributeValue: false,
    trimValues: true,
    isArray: (_name, jpath) => jpath === mapping.items,
  });
  const items = (get(parser.parse(xml), mapping.items) as XmlNode[] | undefined) ?? [];
  const currency = mapping.currency ?? 'TRY';
  const f = mapping.fields;
  const products: Product[] = [];
  const issues: Issue[] = [];

  items.forEach((item, index) => {
    let id = '';
    try {
      id = asText(read(item, f.id)) ?? '';
      const rawPrice = read(item, f.price);
      const price = parseLocalizedNumber(rawPrice ?? '', mapping.decimalSeparator);
      if (!Number.isFinite(price)) {
        issues.push({ productId: id || `#${index + 1}`, field: 'price', severity: 'error', message: `unreadable price "${rawPrice ?? ''}"` });
        return;
      }
      const sale = f.salePrice ? parseLocalizedNumber(read(item, f.salePrice) ?? '', mapping.decimalSeparator) : Number.NaN;
      const images = read(item, f.additionalImageLinks);
      // Optional text fields are only set when the supplier filled them in.
      const optional: Partial<Product> = {};
      for (const key of ['brand', 'gtin', 'mpn', 'productType', 'itemGroupId', 'color', 'size'] as const) {
        const value = asText(read(item, f[key]));
        if (value) optional[key] = value;
      }
      let product: Product | null = {
        ...mapping.defaults,
        id,
        title: asText(read(item, f.title)) ?? '',
        description: asText(read(item, f.description)) ?? asText(read(item, f.title)) ?? '',
        link: asText(read(item, f.link)) ?? '',
        imageLink: asText(read(item, f.imageLink)) ?? '',
        ...(images ? { additionalImageLinks: ([] as unknown[]).concat(images).map(String) } : {}),
        availability: read(item, f.availability) ?? stockToAvailability(read(item, f.stock)),
        price: { amount: price, currency },
        ...(Number.isFinite(sale) && sale > 0 && sale < price ? { salePrice: { amount: sale, currency } } : {}),
        ...optional,
      };
      if (mapping.transform) product = mapping.transform(product, item);
      if (!product) return;
      issues.push(...validateProduct(product));
      products.push(product);
    } catch (e) {
      // One malformed item (or a mapping function that didn't expect it) must not sink the whole catalogue.
      const message = e instanceof Error ? e.message : String(e);
      issues.push({ productId: id || `#${index + 1}`, field: 'item', severity: 'error', message: `could not be mapped: ${message}` });
    }
  });
  return { products, issues };
}
