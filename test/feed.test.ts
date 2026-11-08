import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { FeedValidationError, renderGoogleFeed, streamGoogleFeed, type Issue, type Product } from '../src/index.js';

const channel = { title: 'Örnek Mağaza', link: 'https://www.ornek-magaza.com.tr', description: 'Ürün feed’i' };

const product = (over: Partial<Product> = {}): Product => ({
  id: 'ELB-001',
  title: 'Keten Elbise',
  description: 'Yazlık keten elbise',
  link: 'https://www.ornek-magaza.com.tr/keten-elbise',
  imageLink: 'https://cdn.ornek-magaza.com.tr/elb-001.jpg',
  availability: 'in_stock',
  price: { amount: 1299.9, currency: 'TRY' },
  brand: 'Örnek Moda',
  gtin: '8690000000012',
  condition: 'new',
  ...over,
});

/** Parse the generated feed back, which also proves it is well-formed XML. */
const parse = (xml: string) =>
  new XMLParser({ ignoreAttributes: false, parseTagValue: false, isArray: (n) => n === 'item' || n === 'g:shipping' }).parse(xml);

describe('renderGoogleFeed', () => {
  it('produces RSS 2.0 with the Google namespace and the channel header', async () => {
    const doc = parse(await renderGoogleFeed(channel, [product()]));
    expect(doc.rss['@_version']).toBe('2.0');
    expect(doc.rss['@_xmlns:g']).toBe('http://base.google.com/ns/1.0');
    expect(doc.rss.channel.title).toBe('Örnek Mağaza');
  });

  it('maps fields to g: attributes with Google’s formats', async () => {
    const xml = await renderGoogleFeed(channel, [
      product({
        salePrice: { amount: 999.9, currency: 'TRY' },
        salePriceEffectiveDate: { start: '2026-11-27T00:00+0300', end: '2026-11-30T23:59+0300' },
        shipping: [{ country: 'TR', service: 'Standart', price: { amount: 0, currency: 'TRY' } }],
        customLabels: ['black-friday', 'yaz-koleksiyonu'],
        additionalImageLinks: ['https://cdn.ornek-magaza.com.tr/elb-001-2.jpg'],
      }),
    ]);
    const item = parse(xml).rss.channel.item[0];
    expect(item).toMatchObject({
      'g:id': 'ELB-001',
      'g:price': '1299.90 TRY',
      'g:sale_price': '999.90 TRY',
      'g:sale_price_effective_date': '2026-11-27T00:00+0300/2026-11-30T23:59+0300',
      'g:availability': 'in_stock',
      'g:gtin': '8690000000012',
      'g:additional_image_link': 'https://cdn.ornek-magaza.com.tr/elb-001-2.jpg',
      'g:custom_label_0': 'black-friday',
      'g:custom_label_1': 'yaz-koleksiyonu',
    });
    expect(item['g:shipping'][0]).toEqual({ 'g:country': 'TR', 'g:service': 'Standart', 'g:price': '0.00 TRY' });
  });

  it('omits empty optional attributes, as Google asks', async () => {
    const xml = await renderGoogleFeed(channel, [product({ mpn: '', color: undefined })]);
    expect(xml).not.toContain('<g:mpn>');
    expect(xml).not.toContain('<g:color>');
  });

  it('escapes markup and strips characters XML cannot carry', async () => {
    const xml = await renderGoogleFeed(channel, [product({ title: 'Küpe & Kolye <Set>', description: 'Word\u000Bexport\u0007 text' })]);
    const item = parse(xml).rss.channel.item[0];
    expect(item['g:title']).toBe('Küpe & Kolye <Set>');
    expect(item['g:description']).toBe('Wordexport text');
  });

  it('skips invalid products by default and reports why', async () => {
    const issues: Issue[] = [];
    const xml = await renderGoogleFeed(channel, [product(), product({ id: 'BAD', gtin: '8690000000013' })], { onIssue: (i) => issues.push(i) });
    expect(parse(xml).rss.channel.item).toHaveLength(1);
    expect(issues).toContainEqual(expect.objectContaining({ productId: 'BAD', field: 'gtin', severity: 'error' }));
  });

  it('can stop at the first invalid product instead', async () => {
    await expect(renderGoogleFeed(channel, [product({ price: { amount: -1, currency: 'TRY' } })], { invalid: 'throw' })).rejects.toBeInstanceOf(
      FeedValidationError,
    );
  });

  it('streams large catalogues chunk by chunk with the same output', async () => {
    async function* catalogue() {
      for (let i = 0; i < 1000; i++) yield product({ id: `SKU-${i}` });
    }
    let chunks = 0;
    let streamed = '';
    for await (const chunk of streamGoogleFeed(channel, catalogue())) {
      chunks++;
      streamed += chunk;
    }
    expect(chunks).toBe(1003); // header, channel, 1000 items, footer
    expect(streamed).toBe(await renderGoogleFeed(channel, catalogue()));
    expect(parse(streamed).rss.channel.item).toHaveLength(1000);
  });
});
