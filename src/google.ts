import { normalizeGtin } from './gtin.js';
import type { FeedChannel, Money, Product } from './types.js';
import { validateProduct } from './validate.js';
import { escapeXml } from './xml.js';

export const GOOGLE_NAMESPACE = 'http://base.google.com/ns/1.0';

export class FeedValidationError extends Error {
  override name = 'FeedValidationError';
  constructor(readonly issues: ReturnType<typeof validateProduct>) {
    super(`Product ${issues[0]?.productId}: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`);
  }
}

export interface RenderOptions {
  /**
   * `'skip'` (default) leaves out products with errors and reports them through `onIssue`.
   * `'throw'` stops at the first invalid product. `'off'` renders everything as given.
   */
  invalid?: 'skip' | 'throw' | 'off';
  /** Called for every error and warning. Use it to log, count or fail a build. */
  onIssue?: (issue: ReturnType<typeof validateProduct>[number]) => void;
  /** Indent nested elements, for humans. Default true. */
  pretty?: boolean;
}

const money = (m: Money) => `${m.amount.toFixed(2)} ${m.currency}`;
const isoDate = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

function renderItem(p: Product, nl: string, ind: string): string {
  const lines: string[] = [];
  const tag = (name: string, value: string | undefined, depth = 2) => {
    // Google: remove attributes that have no value.
    if (value !== undefined && value !== '') lines.push(`${ind.repeat(depth)}<g:${name}>${escapeXml(value)}</g:${name}>`);
  };
  tag('id', p.id);
  tag('title', p.title);
  tag('description', p.description);
  tag('link', p.link);
  tag('image_link', p.imageLink);
  p.additionalImageLinks?.slice(0, 10).forEach((url) => tag('additional_image_link', url));
  tag('availability', p.availability);
  if (p.availabilityDate) tag('availability_date', isoDate(p.availabilityDate));
  tag('price', money(p.price));
  if (p.salePrice) tag('sale_price', money(p.salePrice));
  if (p.salePriceEffectiveDate) {
    tag('sale_price_effective_date', `${isoDate(p.salePriceEffectiveDate.start)}/${isoDate(p.salePriceEffectiveDate.end)}`);
  }
  tag('brand', p.brand);
  if (p.gtin) tag('gtin', normalizeGtin(p.gtin));
  tag('mpn', p.mpn);
  if (p.identifierExists === false) tag('identifier_exists', 'no');
  tag('condition', p.condition);
  tag('item_group_id', p.itemGroupId);
  tag('google_product_category', p.googleProductCategory);
  tag('product_type', p.productType);
  tag('color', p.color);
  tag('size', p.size);
  tag('gender', p.gender);
  tag('age_group', p.ageGroup);
  for (const s of p.shipping ?? []) {
    lines.push(`${ind.repeat(2)}<g:shipping>`);
    tag('country', s.country, 3);
    tag('service', s.service, 3);
    if (s.price) tag('price', money(s.price), 3);
    lines.push(`${ind.repeat(2)}</g:shipping>`);
  }
  p.customLabels?.slice(0, 5).forEach((label, i) => tag(`custom_label_${i}`, label));
  return `${ind}<item>${nl}${lines.join(nl)}${nl}${ind}</item>${nl}`;
}

/**
 * Stream a Google Merchant Center RSS 2.0 feed as string chunks, one per product. Memory stays flat for catalogues
 * of any size; pipe it to a file or an HTTP response.
 *
 * @example
 *   await pipeline(Readable.from(streamGoogleFeed(channel, products)), createWriteStream('feed.xml'));
 */
export async function* streamGoogleFeed(
  channel: FeedChannel,
  products: Iterable<Product> | AsyncIterable<Product>,
  opts: RenderOptions = {},
): AsyncGenerator<string> {
  const pretty = opts.pretty ?? true;
  const nl = pretty ? '\n' : '';
  const ind = pretty ? '  ' : '';
  const invalid = opts.invalid ?? 'skip';
  yield `<?xml version="1.0" encoding="UTF-8"?>${nl}<rss xmlns:g="${GOOGLE_NAMESPACE}" version="2.0">${nl}<channel>${nl}`;
  yield `${ind}<title>${escapeXml(channel.title)}</title>${nl}${ind}<link>${escapeXml(channel.link)}</link>${nl}${ind}<description>${escapeXml(channel.description)}</description>${nl}`;
  for await (const product of products) {
    if (invalid !== 'off') {
      const issues = validateProduct(product);
      issues.forEach((issue) => opts.onIssue?.(issue));
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length && invalid === 'throw') throw new FeedValidationError(errors);
      if (errors.length) continue;
    }
    yield renderItem(product, nl, ind);
  }
  yield `</channel>${nl}</rss>${nl}`;
}

/** Render the whole feed to one string. Convenient for small catalogues and tests; prefer the stream for large ones. */
export async function renderGoogleFeed(
  channel: FeedChannel,
  products: Iterable<Product> | AsyncIterable<Product>,
  opts?: RenderOptions,
): Promise<string> {
  let xml = '';
  for await (const chunk of streamGoogleFeed(channel, products, opts)) xml += chunk;
  return xml;
}
