import * as pdfjs from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// How the reader and the library queue open a document: the same transport, from the copy kept
// in the library.
export type PdfSourceOptions = {
  // Stops the reading of the file. Once it is aborted the document is not opened.
  signal: AbortSignal;
  // Called as soon as the loading task exists, so that the caller can destroy it at any time.
  onTask?: (task: PDFDocumentLoadingTask) => void;
  // Asks for the password of a protected document: `null` gives up. Without it a protected
  // document fails to open, which is what a background job wants.
  onPassword?: (incorrect: boolean) => Promise<string | null>;
};
export type PdfSource = {
  task: PDFDocumentLoadingTask;
  // Resolves with the document, or rejects if it is not a PDF, needs a password that was not
  // given, or a part of the file could not be read.
  document: Promise<PDFDocumentProxy>;
};

// Tauri's asset protocol handles Range requests but doesn't advertise them on the initial
// response. Supply an explicit transport to avoid reading entire large documents into native
// memory before PDF.js can discover range support. Resolves with `null` when `signal` was
// aborted while the first bytes were being read.
export async function openPdfSource(
  url: string,
  size: number,
  { signal, onTask, onPassword }: PdfSourceOptions,
): Promise<PdfSource | null> {
  const readRange = async (begin: number, end: number) => {
    const bytes = new Uint8Array(end - begin);
    for (let start = begin; start < end; start += 524288) {
      const stop = Math.min(end, start + 524288);
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${stop - 1}` },
        signal,
      });
      if (response.status !== 206)
        throw new Error(`Não foi possível ler parte do PDF (${response.status}).`);
      const part = new Uint8Array(await response.arrayBuffer());
      if (part.length !== stop - start)
        throw new Error('A cópia do PDF foi alterada ou está incompleta.');
      bytes.set(part, start - begin);
    }
    return bytes;
  };
  const initial = await readRange(0, Math.min(size, 262144));
  if (signal.aborted) return null;
  let rejectRange!: (error: unknown) => void;
  const rangeFailure = new Promise<never>((_, reject) => (rejectRange = reject));
  const transport = new pdfjs.PDFDataRangeTransport(size, initial, false);
  transport.requestDataRange = (begin: number, end: number) => {
    void readRange(begin, end)
      .then((bytes) => {
        if (!signal.aborted) transport.onDataRange(begin, bytes);
      })
      .catch((error) => {
        if (!signal.aborted) {
          rejectRange(error);
          void task.destroy();
        }
      });
  };
  transport.abort = () => {};
  const task = pdfjs.getDocument({
    range: transport,
    cMapUrl: new URL('/pdfjs/cmaps/', location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('/pdfjs/standard_fonts/', location.href).href,
    wasmUrl: new URL('/pdfjs/wasm/', location.href).href,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 262144,
  });
  onTask?.(task);
  if (onPassword)
    task.onPassword = async (updatePassword: (value: string) => void, reason: number) => {
      const password = await onPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
      if (password === null) {
        await task.destroy();
        return;
      }
      updatePassword(password);
    };
  return { task, document: Promise.race([task.promise, rangeFailure]) };
}

// The width of a cover, in pixels. Cards show it small, so this is plenty.
export const COVER_WIDTH = 240;

// Draws the first page of a document as a PNG cover. `viewportAt` gives the page's viewport at a
// scale: the reader passes its own, which knows the page's whole area; by default it is the page's.
// Resolves with `null` if the browser could not encode the image.
export async function renderCover(
  page: PDFPageProxy,
  viewportAt: (scale: number) => PageViewport = (scale) => page.getViewport({ scale }),
): Promise<Uint8Array | null> {
  const viewport = viewportAt(1);
  const scaled = viewportAt(COVER_WIDTH / viewport.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scaled.width);
  canvas.height = Math.ceil(scaled.height);
  try {
    await page.render({ canvas, viewport: scaled }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
