const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Turn supplier HTML ("<p>%100 keten, <b>yazlık</b></p>") into the plain text Google expects in `description`.
 * Block elements become line breaks, inline tags are dropped, entities are decoded and whitespace is collapsed.
 * Scripts and styles are removed with their content.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
      const hex = e[1] === 'x' || e[1] === 'X';
      return String.fromCodePoint(parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10));
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
