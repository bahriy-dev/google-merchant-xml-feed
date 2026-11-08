import { isValidGtin } from './gtin.js';
import type { Availability, Issue, Money, Product } from './types.js';

const AVAILABILITY: Availability[] = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];
const MAX_LENGTH = { id: 50, title: 150, description: 5000 } as const;

const isHttpUrl = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const isMoney = (m: Money | undefined): m is Money =>
  !!m && Number.isFinite(m.amount) && m.amount >= 0 && /^[A-Z]{3}$/.test(m.currency);

/**
 * Check one product against Google Merchant Center's product data rules.
 * `error`: Merchant Center would reject the item. `warning`: accepted, but likely to hurt approval or performance.
 */
export function validateProduct(p: Product): Issue[] {
  const issues: Issue[] = [];
  const productId = p.id || '(missing id)';
  const error = (field: string, message: string) => issues.push({ productId, field, severity: 'error', message });
  const warn = (field: string, message: string) => issues.push({ productId, field, severity: 'warning', message });

  for (const field of ['id', 'title', 'description', 'link', 'imageLink'] as const) {
    if (!p[field]?.trim()) error(field, 'is required');
  }
  for (const [field, max] of Object.entries(MAX_LENGTH) as [keyof typeof MAX_LENGTH, number][]) {
    if (p[field] && p[field].length > max) error(field, `is ${p[field].length} characters, the limit is ${max}`);
  }
  if (p.link && !isHttpUrl(p.link)) error('link', 'must be an absolute http(s) URL');
  if (p.imageLink && !isHttpUrl(p.imageLink)) error('imageLink', 'must be an absolute http(s) URL');
  p.additionalImageLinks?.forEach((url, i) => {
    if (!isHttpUrl(url)) error(`additionalImageLinks[${i}]`, 'must be an absolute http(s) URL');
  });

  if (!AVAILABILITY.includes(p.availability)) error('availability', `must be one of ${AVAILABILITY.join(', ')}`);
  if (p.availability === 'preorder' && !p.availabilityDate) error('availabilityDate', 'is required for preorder');

  if (!isMoney(p.price)) error('price', 'needs a non-negative amount and a 3-letter ISO 4217 currency');
  else if (p.price.amount === 0) warn('price', 'is 0; free products are usually disapproved');
  if (p.salePrice) {
    if (!isMoney(p.salePrice)) error('salePrice', 'needs a non-negative amount and a 3-letter ISO 4217 currency');
    else if (isMoney(p.price) && p.salePrice.currency !== p.price.currency) error('salePrice', 'must use the same currency as price');
    else if (isMoney(p.price) && p.salePrice.amount >= p.price.amount) warn('salePrice', 'is not lower than price');
  }

  if (p.gtin !== undefined && !isValidGtin(p.gtin)) error('gtin', `"${p.gtin}" is not a valid GTIN (length or check digit)`);
  if (!p.gtin && !p.mpn && p.identifierExists !== false) {
    warn('gtin', 'missing: provide gtin, or mpn with brand, or set identifierExists: false');
  }
  if (!p.brand && (p.condition ?? 'new') === 'new') {
    warn('brand', 'is required for new products in most categories (except media such as books, films, music)');
  }

  p.shipping?.forEach((s, i) => {
    if (!/^[A-Z]{2}$/.test(s.country)) error(`shipping[${i}].country`, 'must be an ISO 3166-1 alpha-2 code like "TR"');
    if (s.price && !isMoney(s.price)) error(`shipping[${i}].price`, 'needs a non-negative amount and a currency');
  });
  if (p.customLabels && p.customLabels.length > 5) error('customLabels', 'allows at most 5 labels');
  return issues;
}

/** Validate a whole catalogue, including duplicate IDs across products. */
export function validateProducts(products: Iterable<Product>): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    issues.push(...validateProduct(p));
    if (p.id && seen.has(p.id)) issues.push({ productId: p.id, field: 'id', severity: 'error', message: 'is duplicated' });
    seen.add(p.id);
  }
  return issues;
}
