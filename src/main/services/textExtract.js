const path = require('path');

const PLAIN_EXT = new Set(['.txt', '.md', '.text']);

// Extracts plain text from an uploaded file's buffer for indexing/search/
// RAG context. Never throws — extraction failures come back as a `warning`
// string so the upload still succeeds (the file is kept, just unsearchable
// until fixed), rather than blocking the whole upload.
async function extractText(buffer, ext) {
  if (PLAIN_EXT.has(ext)) {
    return { text: buffer.toString('utf8'), warning: null };
  }

  if (ext === '.pdf') {
    try {
      // pdfjs-dist dropped CommonJS builds entirely as of v4.x — only the
      // ESM (.mjs) build ships now, even under legacy/build/. This file is
      // CommonJS (main.js and friends all use require()), so a plain
      // require() of the old .js path fails with "Cannot find module".
      // Dynamic import() is Node's supported way to load an ESM module from
      // CommonJS, and works fine here since extractText is already async.
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // Points pdfjs at its own bundled standard-fonts/CJK-cmap data (ships
      // in the package regardless) so it can fall back to those for a PDF
      // that references a standard font without embedding it, instead of
      // warning and rendering with default metrics.
      // Plain filesystem paths, not file:// URLs — the legacy Node build
      // reads these straight off disk (fs.readFile) rather than fetching
      // them, unlike the browser build.
      const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
      const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep,
        cMapPacked: true,
      }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(' ') + '\n\n';
      }
      text = text.trim();
      return {
        text,
        warning: text ? null : 'No extractable text found — this looks like a scanned/image-only PDF (OCR isn\'t supported here).',
      };
    } catch (err) {
      return { text: '', warning: `Could not read PDF: ${err.message}` };
    }
  }

  if (ext === '.docx') {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.trim();
      return {
        text,
        warning: result.messages?.length
          ? `Converted with ${result.messages.length} note(s) — some formatting may not have carried over.`
          : null,
      };
    } catch (err) {
      return { text: '', warning: `Could not read Word document: ${err.message}` };
    }
  }

  if (ext === '.doc') {
    // ".doc" covers two unrelated formats in practice: genuine pre-2007
    // binary Word (an OLE compound document, header bytes D0 CF 11 E0) and
    // plain RTF saved with a .doc extension — surprisingly common, since
    // WordPad and some "export as .doc" flows actually write RTF. Sniff the
    // real format from its header rather than trusting the extension, since
    // a file that *is* RTF just fails outright in a .doc-only parser (that's
    // the "Unable to read this type of file" error this replaces).
    const isRtf = buffer.slice(0, 5).toString('latin1') === '{\\rtf';

    if (isRtf) {
      try {
        const parseRTF = require('rtf-parser');
        // RTF's control words are ASCII but the body can carry extended
        // characters per whatever code page the document declares; latin1
        // preserves those bytes 1:1 for rtf-parser's own charset handling,
        // where a UTF-8 decode would corrupt them.
        const doc = await new Promise((resolve, reject) => {
          parseRTF.string(buffer.toString('latin1'), (err, result) => (err ? reject(err) : resolve(result)));
        });
        const text = (doc.content || [])
          .map((para) => (para.content || []).map((span) => span.value || '').join(''))
          .join('\n')
          .trim();
        return { text, warning: text ? null : 'No extractable text found in this .doc (RTF) file.' };
      } catch (err) {
        return { text: '', warning: `Could not read .doc (RTF) file: ${err.message}` };
      }
    }

    try {
      // Genuine OLE-binary .doc — a completely different format from
      // .docx (not a newer version of it, an unrelated file format), so
      // mammoth (.docx-only) can't touch it. word-extractor parses the
      // binary format directly and accepts a Buffer, no temp file needed.
      const WordExtractor = require('word-extractor');
      const doc = await new WordExtractor().extract(buffer);
      const text = doc.getBody().trim();
      return {
        text,
        warning: text ? null : 'No extractable text found in this .doc file.',
      };
    } catch (err) {
      return { text: '', warning: `Could not read .doc file: ${err.message}` };
    }
  }

  return { text: '', warning: `Unsupported file type ${ext}` };
}

module.exports = { extractText, PLAIN_EXT };
