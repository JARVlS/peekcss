// utils/zipExport.ts
// "Download all images" as a single ZIP (§5 Overview, Pro).
//
// Library choice (§5 asked for a size check): fflate tree-shakes to ~11 kB
// minified for zipSync alone vs ~96 kB for JSZip, so fflate keeps the bundle
// lean. Entries are stored uncompressed (level 0) — image formats are already
// compressed, so deflating them again only burns CPU.
import { zipSync } from 'fflate';
import { dataUrlToBlob } from './download';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function buildZip(entries: ZipEntry[]): Blob {
  const input: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    input[uniqueName(entry.name, input)] = entry.data;
  }
  const zipped = zipSync(input, { level: 0 });
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

// Fetches an image's bytes for zipping. Returns null when the bytes are not
// readable from the sidebar (e.g. a cross-origin fetch blocked by CORS — we
// deliberately ship no host permissions); the caller falls back to a direct
// download via the downloads API for those.
export async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    let blob: Blob;
    if (url.startsWith('data:')) {
      blob = dataUrlToBlob(url);
    } else {
      const response = await fetch(url);
      if (!response.ok) return null;
      blob = await response.blob();
    }
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function uniqueName(name: string, existing: Record<string, unknown>): string {
  if (!(name in existing)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!(candidate in existing)) return candidate;
  }
}
