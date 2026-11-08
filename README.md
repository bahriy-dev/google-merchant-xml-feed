# ecommerce-xml-feed

[![CI](https://github.com/bahriy-dev/ecommerce-xml-feed/actions/workflows/ci.yml/badge.svg)](https://github.com/bahriy-dev/ecommerce-xml-feed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

**Build Google Merchant Center product feeds (RSS 2.0 XML) and import supplier / dealer XML catalogues in TypeScript.**
It validates products against Google's product data specification, checks GTIN check digits, reads Turkish and
European price formats, and streams catalogues of any size.

**[Türkçe açıklama aşağıda ↓](#türkçe)**

```
supplier.xml ──▶ importSupplierXml(mapping) ──▶ Product[] ──▶ streamGoogleFeed() ──▶ google-feed.xml
 (any shape)       parse · map · validate        typed        validate · escape        Merchant Center
```

## Quick start

```ts
import { renderGoogleFeed } from 'ecommerce-xml-feed';

const xml = await renderGoogleFeed(
  { title: 'My Store', link: 'https://shop.example.com', description: 'Product feed' },
  [
    {
      id: 'ELB-001',
      title: 'Linen Dress, Beige',
      description: '100% linen summer dress.',
      link: 'https://shop.example.com/linen-dress',
      imageLink: 'https://cdn.example.com/elb-001.jpg',
      availability: 'in_stock',
      price: { amount: 1299.9, currency: 'TRY' },
      salePrice: { amount: 999.9, currency: 'TRY' },
      brand: 'Example',
      gtin: '8690000000012',
      shipping: [{ country: 'TR', price: { amount: 0, currency: 'TRY' } }],
    },
  ],
);
```

```xml
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
  <title>My Store</title>
  …
  <item>
    <g:id>ELB-001</g:id>
    <g:price>1299.90 TRY</g:price>
    <g:sale_price>999.90 TRY</g:sale_price>
    <g:gtin>8690000000012</g:gtin>
    <g:shipping>
      <g:country>TR</g:country>
      <g:price>0.00 TRY</g:price>
    </g:shipping>
    …
```

## Features

| | |
| --- | --- |
| **Google Merchant Center RSS 2.0** | `g:` namespace, price as `"1299.90 TRY"`, nested `g:shipping`, `custom_label_0…4`. Empty attributes are omitted, as Google asks. |
| **Validation before Google sees it** | Required attributes; length limits (id 50, title 150, description 5000); absolute URLs; availability values; `availability_date` for preorders; sale price vs. price; duplicate IDs. |
| **GTIN check digits** | EAN-13, UPC-12, GTIN-8, ITF-14 with the GS1 mod-10 checksum. Barcodes stay strings, so leading zeros survive. |
| **Supplier XML import** | One mapping object per supplier: dotted paths (`Resimler.Resim`), attributes (`@_kod`) or functions. |
| **Prices the way suppliers write them** | `1.299,90` · `1,299.90` · `3.750,00 TL`. Ambiguous values like `1.250` are **reported, not guessed**, unless you set `decimalSeparator`. |
| **Robust import** | One malformed item is reported and skipped; the rest of the catalogue still imports. External entities (XXE) are refused. |
| **Clean output** | XML-escaped, with control characters from Word/ERP exports removed (one of them makes a whole feed unparsable). `htmlToText()` turns HTML descriptions into plain text. |
| **Streaming** | `streamGoogleFeed()` is an async generator. 100k products never sit in memory as one string. |

## Import a supplier XML

Every supplier (tedarikçi / bayi) names things differently. Only the mapping changes:

```xml
<Urunler>
  <Urun kod="ELB-001">
    <UrunAdi>Keten Gömlek Elbise - Bej</UrunAdi>
    <Aciklama><![CDATA[<p>%100 keten, <b>yazlık</b> elbise.</p>]]></Aciklama>
    <Barkod>8690000000012</Barkod>
    <Fiyat>1.299,90</Fiyat>
    <Stok>14</Stok>
    <Resimler><Resim>https://…/1.jpg</Resim><Resim>https://…/2.jpg</Resim></Resimler>
    …
```

```ts
import { importSupplierXml, htmlToText } from 'ecommerce-xml-feed';

const images = (item) => [item.Resimler?.Resim ?? []].flat();

const { products, issues } = importSupplierXml(xml, {
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
    stock: 'Stok',            // 0 → out_of_stock, >0 → in_stock
    brand: 'Marka',
    gtin: 'Barkod',
    productType: 'Kategori',
  },
  decimalSeparator: ',',      // the supplier writes 1.250 for one thousand two hundred fifty
  defaults: { condition: 'new' },
  transform: (p) =>           // your business rules: margin, filtering, clean-up
    p.availability === 'out_of_stock' ? null : { ...p, description: htmlToText(p.description) },
});
```

`issues` lists every problem with the product ID and field, ready for a log or an email to the supplier:

```
✗ CNT-003  gtin "8690000000013" is not a valid GTIN (length or check digit)
✗ HTL-004  price unreadable price "fiyat sorunuz"
```

A runnable version is in [`examples/supplier-to-google.ts`](examples/supplier-to-google.ts) (`npm run example`).

## Large catalogues: stream to a file or an HTTP response

```ts
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { streamGoogleFeed } from 'ecommerce-xml-feed';

async function* productsFromDb() {
  for await (const row of db.products.cursor()) yield toProduct(row);
}

await pipeline(Readable.from(streamGoogleFeed(channel, productsFromDb())), createWriteStream('public/google-feed.xml'));
```

## API

| Function | |
| --- | --- |
| `renderGoogleFeed(channel, products, options?)` | Whole feed as a string. |
| `streamGoogleFeed(channel, products, options?)` | Async generator of string chunks. Accepts arrays, iterables and async iterables. |
| `validateProduct(product)` / `validateProducts(products)` | `Issue[]` with `severity: 'error' \| 'warning'`. |
| `importSupplierXml(xml, mapping)` | `{ products, issues }`. |
| `isValidGtin(code)` · `normalizeGtin(code)` | GS1 check-digit validation. |
| `parseLocalizedNumber(text, decimalSeparator?)` | `"1.299,90"` → `1299.9`. Ambiguous input → `NaN`. |
| `stockToAvailability(qty)` · `htmlToText(html)` · `escapeXml(text)` | Helpers. |

Render options: `invalid: 'skip' | 'throw' | 'off'` (default `'skip'`), `onIssue(issue)`, `pretty` (default `true`).

## What this library doesn't do

- **Upload to Merchant Center.** Host the file and add it as a scheduled fetch, or push it with the Merchant API.
- **Decide categories, tax or legal texts for you.** `googleProductCategory`, prices including VAT, and so on are
  your data.
- **Guarantee other channels.** Other catalogue importers often read RSS 2.0 with the `g:` namespace too, but each has
  its own required fields and rules. Check the channel's spec before reusing the feed.

Validation rules follow Google's [product data specification](https://support.google.com/merchants/answer/7052112)
and [RSS 2.0 feed format](https://support.google.com/merchants/answer/14987622).

---

## Türkçe

**Google Merchant Center XML ürün feed'i oluşturma ve tedarikçi / bayi XML entegrasyonu için TypeScript
kütüphanesi.**

- **Google Alışveriş feed'i:** RSS 2.0, `g:` namespace, `"1299.90 TRY"` fiyat formatı, kargo ve kampanya etiketleri.
- **Google'a göndermeden doğrulama:** zorunlu alanlar, karakter sınırları, URL'ler, stok durumu, indirimli fiyat,
  aynı ID'nin tekrarı.
- **Barkod (EAN-13 / GTIN) kontrolü:** kontrol hanesi hesaplanır. Baştaki sıfırlar kaybolmaz.
- **Tedarikçi XML'i içe aktarma:** her tedarikçinin farklı alan adları (`UrunAdi`, `Fiyat`, `Stok`, `Barkod`…) tek
  bir eşleştirme nesnesiyle okunur.
- **Türkçe fiyat formatı:** `1.299,90` ve `3.750,00 TL` doğru okunur. `1.250` gibi belirsiz bir değer tahmin
  edilmez, raporlanır. 1000 kat yanlış fiyat yayınlamak yerine `decimalSeparator: ','` ayarlanır.
- **Hatalı ürün feed'i bozmaz:** sorunlu ürün, ürün kodu ve alan adıyla raporlanır, geri kalan katalog yayınlanır.
- **HTML açıklamalar** `htmlToText()` ile düz metne çevrilir.
- **Büyük kataloglar** stream ile dosyaya yazılır; bellek kullanımı sabit kalır.

Tipik kullanım: tedarikçi XML'ini çek, kâr marjını ve stok kuralını uygula, Google Merchant Center'a ve diğer
kanallara feed üret.

## Development

```bash
npm install
npm test          # 54 tests
npm run example   # examples/tedarikci.xml → examples/google-feed.xml
npm run build
```

## License

[MIT](LICENSE)
