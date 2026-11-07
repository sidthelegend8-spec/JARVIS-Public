/**
 * Minimal PDF writer.
 *
 * Written by hand rather than pulled from a library: the requirement is plain
 * text documents, and a PDF of that shape is a few hundred lines of well-
 * specified structure. It avoids adding a dependency to the installer for
 * something this contained.
 *
 * Produces a single-font, multi-page A4 document with wrapped text.
 */

const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const TITLE_SIZE = 17;

const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/** Helvetica is roughly 0.5em average per character at this size. */
const charsPerLine = (size: number) => Math.floor(USABLE_WIDTH / (size * 0.5));

/** Escape the three characters that terminate a PDF string literal. */
const escapeText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text: string, width: number): string[] {
  const out: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      // A single word longer than the line is broken rather than overflowing.
      if (word.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
        continue;
      }
      if ((line + (line ? ' ' : '') + word).length > width) {
        out.push(line);
        line = word;
      } else {
        line += (line ? ' ' : '') + word;
      }
    }
    if (line) out.push(line);
  }

  return out;
}

function contentStream(lines: string[], title?: string): string {
  const parts: string[] = ['BT'];
  let y = PAGE_HEIGHT - MARGIN;

  if (title) {
    parts.push(`/F2 ${TITLE_SIZE} Tf`, `1 0 0 1 ${MARGIN} ${y} Tm`, `(${escapeText(title)}) Tj`);
    y -= LINE_HEIGHT * 2;
  }

  parts.push(`/F1 ${FONT_SIZE} Tf`);
  for (const line of lines) {
    parts.push(`1 0 0 1 ${MARGIN} ${y} Tm`, `(${escapeText(line)}) Tj`);
    y -= LINE_HEIGHT;
  }

  parts.push('ET');
  return parts.join('\n');
}

/**
 * Build the PDF. Objects are written in order and their byte offsets recorded
 * for the cross-reference table, which is what makes the file readable.
 */
export function buildPdf(text: string, title?: string): Buffer {
  const lines = wrap(text, charsPerLine(FONT_SIZE));
  const firstPageCapacity = title ? LINES_PER_PAGE - 2 : LINES_PER_PAGE;

  const pages: string[][] = [];
  pages.push(lines.slice(0, firstPageCapacity));
  for (let i = firstPageCapacity; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 for the catalogue and 2 for the page tree so the page objects,
  // which must reference the tree, can be written before it is finalised.
  objects.push('', '');

  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const pageIds: number[] = [];
  pages.forEach((pageLines, index) => {
    const stream = contentStream(pageLines, index === 0 ? title : undefined);
    const contentId = add(
      `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>`
      )
    );
  });

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
