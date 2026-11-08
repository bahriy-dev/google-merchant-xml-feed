import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importSupplierXml, parseLocalizedNumber, renderGoogleFeed, stockToAvailability, type SupplierMapping } from '../src/index.js';

const xml = readFileSync(new URL('./fixtures/tedarikci.xml', import.meta.url), 'utf8');

const mapping: SupplierMapping = {
  items: 'Urunler.Urun',
  fields: {
    id: '@_kod',
    title: 'UrunAdi',
    description: 'Aciklama',
    link: 'Url',
    imageLink: (item) => [(item.Resimler as { Resim?: string | string[] } | undefined)?.Resim ?? []].flat()[0],
    additionalImageLinks: (item) => [(item.Resimler as { Resim?: string | string[] } | undefined)?.Resim ?? []].flat().slice(1),
    price: 'Fiyat',
    salePrice: 'IndirimliFiyat',
    stock: 'Stok',
    brand: 'Marka',
    gtin: 'Barkod',
    productType: 'Kategori',
  },
  defaults: { condition: 'new', shipping: [{ country: 'TR', price: { amount: 0, currency: 'TRY' } }] },
};

describe('parseLocalizedNumber', () => {
  it.each([
    ['1.299,90', 1299.9],
    ['1,299.90', 1299.9],
    ['1299,90', 1299.9],
    ['2499.5', 2499.5],
    ['3.750,00 TL', 3750],
    ['1.299.000', 1299000],
    ['1,299,000.50', 1299000.5],
    [' 15 ', 15],
  ])('%s → %d', (input, expected) => {
    expect(parseLocalizedNumber(input)).toBe(expected);
  });

  it.each(['fiyat sorunuz', '', '1,2,3,4', '12a', '₺ 1.250', '1,299'])('rejects %s (unreadable or ambiguous)', (input) => {
    expect(parseLocalizedNumber(input)).toBeNaN();
  });

  it('reads ambiguous values once the decimal mark is known', () => {
    expect(parseLocalizedNumber('₺ 1.250', ',')).toBe(1250);
    expect(parseLocalizedNumber('1.250', '.')).toBe(1.25);
    expect(parseLocalizedNumber('1,299', '.')).toBe(1299);
    expect(parseLocalizedNumber('1.299.000,75', ',')).toBe(1299000.75);
  });
});

describe('stockToAvailability', () => {
  it('maps quantities to availability', () => {
    expect(stockToAvailability('14')).toBe('in_stock');
    expect(stockToAvailability(0)).toBe('out_of_stock');
    expect(stockToAvailability('yok')).toBe('out_of_stock');
    expect(stockToAvailability(undefined)).toBe('out_of_stock');
  });
});

describe('importSupplierXml', () => {
  const { products, issues } = importSupplierXml(xml, mapping);

  it('maps a Turkish supplier catalogue to products', () => {
    expect(products.map((p) => p.id)).toEqual(['ELB-001', 'KUP-002', 'CNT-003']);
    expect(products[0]).toMatchObject({
      title: 'Keten Gömlek Elbise - Bej',
      description: '<p>%100 keten, <b>yazlık</b> elbise.</p>',
      price: { amount: 1299.9, currency: 'TRY' },
      salePrice: { amount: 999.9, currency: 'TRY' },
      availability: 'in_stock',
      productType: 'Kadın > Giyim > Elbise',
      additionalImageLinks: ['https://cdn.ornek-magaza.com.tr/elb-001-2.jpg'],
      condition: 'new',
    });
  });

  it('keeps barcode leading zeros and decodes entities', () => {
    expect(products[1]).toMatchObject({ gtin: '0012345678905', title: 'Gümüş Küpe & Kolye Seti', availability: 'out_of_stock' });
  });

  it('reports unreadable prices and invalid barcodes instead of publishing them', () => {
    expect(issues).toContainEqual(expect.objectContaining({ productId: 'HTL-004', field: 'price', severity: 'error' }));
    expect(issues).toContainEqual(expect.objectContaining({ productId: 'CNT-003', field: 'gtin', severity: 'error' }));
  });

  it('goes straight into a Google feed, which drops the invalid product', async () => {
    const feed = await renderGoogleFeed({ title: 'Örnek', link: 'https://www.ornek-magaza.com.tr', description: 'Feed' }, products);
    expect(feed).toContain('<g:id>ELB-001</g:id>');
    expect(feed).toContain('<g:id>KUP-002</g:id>');
    expect(feed).not.toContain('CNT-003');
  });

  it('lets transform adjust or drop products', () => {
    const withMargin = importSupplierXml(xml, {
      ...mapping,
      transform: (p) => (p.availability === 'out_of_stock' ? null : { ...p, price: { ...p.price, amount: Math.round(p.price.amount * 1.2) } }),
    });
    expect(withMargin.products.map((p) => p.id)).toEqual(['ELB-001', 'CNT-003']);
    expect(withMargin.products[0]!.price.amount).toBe(1560);
  });

  it('refuses external entities outright (no XXE)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Urunler><Urun kod="X"><UrunAdi>&xxe;</UrunAdi><Fiyat>1</Fiyat></Urun></Urunler>`;
    expect(() => importSupplierXml(evil, mapping)).toThrow(/External entities are not supported/);
  });

  it('reports an item whose mapping throws, and keeps importing the rest', () => {
    const strict: SupplierMapping = { ...mapping, fields: { ...mapping.fields, imageLink: (item) => (item.Resimler as { Resim: string }).Resim } };
    const tr = '<Urunler><Urun kod="A"><UrunAdi>A</UrunAdi><Fiyat>10</Fiyat></Urun><Urun kod="B"><UrunAdi>B</UrunAdi><Fiyat>10</Fiyat><Resimler><Resim>https://x.tr/b.jpg</Resim></Resimler></Urun></Urunler>';
    const result = importSupplierXml(tr, strict);
    expect(result.products.map((p) => p.id)).toEqual(['B']);
    expect(result.issues).toContainEqual(expect.objectContaining({ productId: 'A', field: 'item', severity: 'error' }));
  });

  it('reads Turkish thousands-only prices with decimalSeparator', () => {
    const tr = '<Urunler><Urun kod="A"><UrunAdi>A</UrunAdi><Fiyat>1.250</Fiyat></Urun></Urunler>';
    expect(importSupplierXml(tr, mapping).issues).toContainEqual(expect.objectContaining({ productId: 'A', field: 'price' }));
    expect(importSupplierXml(tr, { ...mapping, decimalSeparator: ',' }).products[0]!.price.amount).toBe(1250);
  });
});
