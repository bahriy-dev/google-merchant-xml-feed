import { describe, expect, it } from 'vitest';
import { isValidGtin, validateProduct, validateProducts, type Product } from '../src/index.js';

const base: Product = {
  id: 'SKU-1',
  title: 'Ürün',
  description: 'Açıklama',
  link: 'https://example.com/p/1',
  imageLink: 'https://example.com/p/1.jpg',
  availability: 'in_stock',
  price: { amount: 100, currency: 'TRY' },
  brand: 'Marka',
  gtin: '8690000000012',
};
const fields = (p: Partial<Product>, severity: 'error' | 'warning' = 'error') =>
  validateProduct({ ...base, ...p }).filter((i) => i.severity === severity).map((i) => i.field);

describe('isValidGtin', () => {
  it.each(['8690000000012', '0012345678905', '96385074', '00012345678905', '869-0000-000012', '8690 0000 00012'])('accepts %s', (gtin) => {
    expect(isValidGtin(gtin)).toBe(true);
  });
  it.each(['8690000000013', '12345', '86900000000ab', '', '123456789012345'])('rejects %s', (gtin) => {
    expect(isValidGtin(gtin)).toBe(false);
  });
});

describe('validateProduct', () => {
  it('accepts a complete product', () => {
    expect(validateProduct(base)).toEqual([]);
  });

  it('requires the core attributes', () => {
    expect(fields({ id: '', title: ' ', link: '', imageLink: '' })).toEqual(expect.arrayContaining(['id', 'title', 'link', 'imageLink']));
  });

  it('enforces Google’s length limits', () => {
    expect(fields({ id: 'x'.repeat(51) })).toContain('id');
    expect(fields({ title: 'x'.repeat(151) })).toContain('title');
    expect(fields({ description: 'x'.repeat(5001) })).toContain('description');
    expect(fields({ title: 'x'.repeat(150) })).toEqual([]);
  });

  it('requires absolute http(s) URLs', () => {
    expect(fields({ link: '/urun/1' })).toContain('link');
    expect(fields({ imageLink: 'ftp://example.com/a.jpg' })).toContain('imageLink');
  });

  it('requires availabilityDate for preorders', () => {
    expect(fields({ availability: 'preorder' })).toContain('availabilityDate');
    expect(fields({ availability: 'preorder', availabilityDate: '2026-12-01T09:00+0300' })).toEqual([]);
  });

  it('checks prices and sale prices', () => {
    expect(fields({ price: { amount: Number.NaN, currency: 'TRY' } })).toContain('price');
    expect(fields({ price: { amount: 10, currency: 'TL' } })).toContain('price');
    expect(fields({ salePrice: { amount: 50, currency: 'USD' } })).toContain('salePrice');
    expect(fields({ salePrice: { amount: 150, currency: 'TRY' } }, 'warning')).toContain('salePrice');
  });

  it('warns when no product identifier is given, unless identifierExists is false', () => {
    expect(fields({ gtin: undefined }, 'warning')).toContain('gtin');
    expect(fields({ gtin: undefined, identifierExists: false }, 'warning')).not.toContain('gtin');
  });

  it('validates shipping countries', () => {
    expect(fields({ shipping: [{ country: 'Türkiye' }] })).toContain('shipping[0].country');
  });
});

describe('validateProducts', () => {
  it('flags duplicate IDs across the catalogue', () => {
    const issues = validateProducts([base, { ...base }]);
    expect(issues).toEqual([expect.objectContaining({ productId: 'SKU-1', field: 'id', message: 'is duplicated' })]);
  });
});
