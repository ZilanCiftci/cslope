/**
 * pdf.js's worker, bundled with the app (a module worker of the app's own
 * origin, as the Content Security Policy's worker-src 'self' allows):
 * loading the worker module starts its message handler on this worker's
 * port. sources.ts hands the worker to pdf.js (GlobalWorkerOptions.workerPort).
 */
import "pdfjs-dist/build/pdf.worker.min.mjs";
