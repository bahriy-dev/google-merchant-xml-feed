import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/index.js';

describe('htmlToText', () => {
  it('strips inline tags and keeps the words', () => {
    expect(htmlToText('<p>%100 keten, <b>yazlık</b> elbise.</p>')).toBe('%100 keten, yazlık elbise.');
  });

  it('turns blocks and lists into readable lines', () => {
    expect(htmlToText('<h2>Özellikler</h2><ul><li>Pamuk</li><li>Makinede yıkanır</li></ul><p>Bir<br>iki</p>')).toBe(
      'Özellikler\n• Pamuk\n• Makinede yıkanır\nBir\niki',
    );
  });

  it('decodes entities and drops scripts', () => {
    expect(htmlToText('Ta&amp;Ka &#304;stanbul&nbsp;&#x15F;ehir<script>alert(1)</script>')).toBe('Ta&Ka İstanbul şehir');
  });
});
