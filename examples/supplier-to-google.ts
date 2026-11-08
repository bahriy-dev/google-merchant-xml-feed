// Supplier XML in, Google Merchant Center feed out.
// Run: npm run example  →  writes examples/google-feed.xml and prints a report.
import { createWriteStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { htmlToText, importSupplierXml, streamGoogleFeed } from '../src/index.js';

const images = (item: Record<string, unknown>) => [(item.Resimler as { Resim?: string | string[] } | undefined)?.Resim ?? []].flat();

// 1. Map the supplier's format once. Every supplier names things differently; only this object changes.
const { products, issues } = importSupplierXml(readFileSync(new URL('./tedarikci.xml', import.meta.url), 'utf8'), {
  items: 'Urunler.Urun',
  fields: {
    id: '@_kod',
    title: 'UrunAdi',
    description: 'Aciklama',
    link: 'Url',
    imageLink: (item) => images(item)[0],
    additionalImageLinks: (item) => images(item).slice(1),
    price: 'Fiyat',
    salePrice: 'IndirimliFiyat',
    stock: 'Stok',
    brand: 'Marka',
    gtin: 'Barkod',
    productType: 'Kategori',
  },
  decimalSeparator: ',',
  defaults: { condition: 'new', shipping: [{ country: 'TR', service: 'Standart', price: { amount: 0, currency: 'TRY' } }] },
  // 2. Business rules: 20% margin, rounded to .90, out-of-stock items left out.
  transform: (p) => {
    if (p.availability === 'out_of_stock') return null;
    const withMargin = (amount: number) => Math.ceil(amount * 1.2) - 0.1;
    return {
      ...p,
      description: htmlToText(p.description), // Google wants plain text
      price: { ...p.price, amount: withMargin(p.price.amount) },
      ...(p.salePrice && { salePrice: { ...p.salePrice, amount: withMargin(p.salePrice.amount) } }),
    };
  },
});

// 3. Stream the feed to disk. Products with errors (already reported by the import) are skipped.
await pipeline(
  Readable.from(
    streamGoogleFeed({ title: 'Örnek Mağaza', link: 'https://www.ornek-magaza.com.tr', description: 'Google Merchant Center ürün feed’i' }, products),
  ),
  createWriteStream(new URL('./google-feed.xml', import.meta.url)),
);

const errors = issues.filter((i) => i.severity === 'error');
console.log(`Mapped ${products.length} in-stock products, ${errors.length} errors:`);
for (const i of errors) console.log(`  ✗ ${i.productId}  ${i.field} ${i.message}`);
