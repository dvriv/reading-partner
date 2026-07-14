import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { ChapterInput } from './chunker.js';

export type ParsedEpub = {
  metadata: { title: string; author?: string; language?: string };
  chapters: ChapterInput[];
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(p|div|section|article|br|h[1-6])\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index + 1);
}

export async function parseEpub(buffer: Buffer, fallbackTitle: string): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buffer);
  const containerText = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerText) throw new Error('Invalid EPUB: missing container.xml');
  const container = parser.parse(containerText) as { container?: { rootfiles?: { rootfile?: { 'full-path'?: string } } } };
  const opfPath = container.container?.rootfiles?.rootfile?.['full-path'];
  if (!opfPath) throw new Error('Invalid EPUB: missing OPF path');
  const opfText = await zip.file(opfPath)?.async('text');
  if (!opfText) throw new Error('Invalid EPUB: missing OPF file');
  const opf = parser.parse(opfText) as {
    package?: {
      metadata?: { ['dc:title']?: string; ['dc:creator']?: string; ['dc:language']?: string };
      manifest?: { item?: Array<{ id: string; href: string; 'media-type': string }> | { id: string; href: string; 'media-type': string } };
      spine?: { itemref?: Array<{ idref: string }> | { idref: string } };
    };
  };
  const manifest = new Map(arrayify(opf.package?.manifest?.item).map((item) => [item.id, item]));
  const base = dirname(opfPath);
  let globalOffset = 0;
  const chapters: ChapterInput[] = [];
  for (const itemRef of arrayify(opf.package?.spine?.itemref)) {
    const item = manifest.get(itemRef.idref);
    if (!item || !/xhtml|html/i.test(item['media-type'])) continue;
    const path = `${base}${item.href}`.replace(/\/[^/]+\/\.\.\//g, '/');
    const html = await zip.file(path)?.async('text');
    if (!html) continue;
    const text = stripHtml(html);
    if (text.length < 20) continue;
    chapters.push({
      chapterNumber: chapters.length + 1,
      title: `Chapter ${chapters.length + 1}`,
      text,
      startOffset: globalOffset,
    });
    globalOffset += text.length + 2;
  }
  if (chapters.length === 0) throw new Error('No readable chapters found in EPUB.');
  return {
    metadata: {
      title: opf.package?.metadata?.['dc:title'] || fallbackTitle.replace(/\.epub$/i, ''),
      author: opf.package?.metadata?.['dc:creator'],
      language: opf.package?.metadata?.['dc:language'],
    },
    chapters,
  };
}
