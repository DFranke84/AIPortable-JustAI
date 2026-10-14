// In-app PDF viewer for the Reference Library — renders a PDF using
// pdf.js's own viewer component (pdf_viewer.mjs), not Chromium's built-in
// plugin viewer, so nothing here needs a <webview> tag (this app's security
// model deliberately avoids that — see the README's "Security notes").
// Loaded as an ES module (index.html: <script type="module" ...>) since
// pdf.js only ships ESM builds; renderer.js itself stays a classic script,
// so this exposes a small window.libraryPdfViewer API for it to call.
import * as pdfjsLib from './vendor/pdf.mjs';
import { EventBus, PDFViewer, PDFLinkService } from './vendor/pdf_viewer.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';

let viewer = null;
let linkService = null;
let loadingTask = null;

function ensureViewer() {
  if (viewer) return viewer;
  const container = document.getElementById('pdf-viewer-container');
  const innerViewer = document.getElementById('pdf-viewer-inner');
  const eventBus = new EventBus();
  linkService = new PDFLinkService({ eventBus });
  viewer = new PDFViewer({ container, viewer: innerViewer, eventBus, linkService, textLayerMode: 2 });
  linkService.setViewer(viewer);
  eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; });
  return viewer;
}

// `url` is a libpdf://<filename> URL (see registerLibraryPdfProtocol in
// main.js) — Range-supported, so pdf.js only fetches the pages it actually
// renders rather than the whole (sometimes 90MB+) file up front.
async function show(url) {
  const v = ensureViewer();
  if (loadingTask) {
    try { await loadingTask.destroy(); } catch { /* already gone */ }
  }
  loadingTask = pdfjsLib.getDocument(url);
  const pdfDocument = await loadingTask.promise;
  v.setDocument(pdfDocument);
  linkService.setDocument(pdfDocument, null);
}

function clear() {
  if (loadingTask) {
    loadingTask.destroy().catch(() => {});
    loadingTask = null;
  }
  if (viewer) viewer.setDocument(null);
}

window.libraryPdfViewer = { show, clear };
