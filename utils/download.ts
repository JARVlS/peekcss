// Shared, context-agnostic helpers for the asset-download feature.
//
// These functions never touch the downloads API directly — they only prepare
// the data (blobs, filenames) so the same logic can be reused from the popup
// and unit-tested in isolation.

// Result of an attempted download, surfaced back to the popup UI so a failure
// is never silent.
export type DownloadOutcome = { ok: true } | { ok: false; error: string };

// Maps an image MIME type to a sensible file extension. Anything unknown falls
// back to "png" so the file still opens as an image in most viewers.
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
};

const FALLBACK_EXTENSION = 'png';

// Parses a `data:` URL into a Blob WITHOUT using fetch(). Avoiding fetch() means
// this keeps working under strict `connect-src` Content Security Policies, and
// it sidesteps the fact that some browsers refuse to fetch large data: URLs.
//
// Supports both base64 (`;base64,`) and percent-encoded payloads (common for
// inline SVG).
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIndex === -1) {
    throw new Error('Not a valid data: URL');
  }

  // The part between "data:" and "," describes the payload, e.g.
  // "image/png;base64" or "image/svg+xml;charset=utf-8".
  const header = dataUrl.slice('data:'.length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = mimeFromDataUrlHeader(header, isBase64);

  let bytes: Uint8Array<ArrayBuffer>;
  if (isBase64) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    // Percent-encoded text payload (e.g. inline SVG). Decode the escapes, then
    // encode to UTF-8 bytes. Copy into a fresh ArrayBuffer-backed view so the
    // result is a valid BlobPart.
    const text = decodeURIComponent(payload);
    const encoded = new TextEncoder().encode(text);
    bytes = new Uint8Array(encoded.length);
    bytes.set(encoded);
  }

  return new Blob([bytes], { type: mime });
}

function mimeFromDataUrlHeader(header: string, isBase64: boolean): string {
  const withoutBase64 = isBase64 ? header.replace(/;base64$/i, '') : header;
  const mime = withoutBase64.split(';')[0].trim().toLowerCase();
  return mime || 'application/octet-stream';
}

// Reads the MIME type from a full data: URL (e.g. "data:image/png;base64,..." →
// "image/png").
export function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl);
  return match ? match[1].trim().toLowerCase() : 'application/octet-stream';
}

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? FALLBACK_EXTENSION;
}

// Strips query strings, fragments, path separators and characters that are
// illegal in filenames on Windows/macOS/Linux. Never returns an empty string.
export function sanitizeFilename(name: string): string {
  // Drop anything after a "?" or "#" — query strings must never reach the disk.
  let cleaned = name.split(/[?#]/)[0];
  // Replace path separators, reserved characters and control characters.
  cleaned = cleaned.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
  // Disallow leading dots so we never produce a hidden file or "..".
  cleaned = cleaned.replace(/^\.+/, '').trim();
  return cleaned || 'image';
}

// Derives a safe download filename for any image URL scheme.
//   - http(s): use the last path segment, append an extension if missing.
//   - data:   no path exists, so build "image-<index>.<ext>" from the MIME type.
//   - blob:   the type is unknown until the blob is read, so use a provisional
//             name; applyBlobExtension() fixes the extension afterwards.
export function filenameForAsset(url: string, index: number): string {
  if (url.startsWith('data:')) {
    const extension = extensionForMime(mimeFromDataUrl(url));
    return `image-${index}.${extension}`;
  }

  if (url.startsWith('blob:')) {
    return `image-${index}.${FALLBACK_EXTENSION}`;
  }

  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if (lastSegment) {
      const name = sanitizeFilename(decodeURIComponent(lastSegment));
      if (hasExtension(name)) {
        return name;
      }
      return `${name}.${FALLBACK_EXTENSION}`;
    }
  } catch {
    // Malformed URL — fall through to the generic name.
  }

  return `image-${index}.${FALLBACK_EXTENSION}`;
}

// Ensures the filename's extension matches the actual blob type. Used for
// blob:/data: downloads where the real MIME type is only known after reading.
export function applyBlobExtension(filename: string, blobType: string): string {
  if (!blobType) {
    return filename;
  }
  const expected = extensionForMime(blobType);
  if (hasExtension(filename)) {
    return filename;
  }
  return `${filename}.${expected}`;
}

function hasExtension(name: string): boolean {
  return /\.[a-z0-9]+$/i.test(name);
}
