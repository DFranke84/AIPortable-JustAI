// Splits document text into overlapping chunks for search/embedding.
// Strategy: pack whole paragraphs together up to ~targetSize chars; any
// paragraph already bigger than maxSize gets split on sentence boundaries
// instead of an arbitrary character cut. A short overlap is then stitched
// onto the front of each chunk (except the first) so a fact sitting right
// at a chunk boundary doesn't get orphaned in only one of the two chunks.
const TARGET_SIZE = 650;
const MAX_SIZE = 900;
const OVERLAP_RATIO = 0.15;

function splitIntoSentences(text) {
  // Not linguistically perfect (doesn't special-case abbreviations like
  // "Dr." or "e.g."), but chunk boundaries don't need to be — this just
  // needs to avoid cutting mid-sentence most of the time.
  return text.match(/[^.!?]+[.!?]+(\s+|$)/g) || [text];
}

function splitOversizedParagraph(paragraph, maxSize) {
  const sentences = splitIntoSentences(paragraph);
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > maxSize && buf) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function chunkText(text, { targetSize = TARGET_SIZE, maxSize = MAX_SIZE, overlapRatio = OVERLAP_RATIO } = {}) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  // Pass 1: greedily pack paragraphs into ~targetSize chunks.
  const base = [];
  let buf = '';
  for (const para of paragraphs) {
    if (para.length > maxSize) {
      if (buf) { base.push(buf.trim()); buf = ''; }
      base.push(...splitOversizedParagraph(para, targetSize));
      continue;
    }
    if (buf && (buf + '\n\n' + para).length > targetSize) {
      base.push(buf.trim());
      buf = para;
    } else {
      buf = buf ? buf + '\n\n' + para : para;
    }
  }
  if (buf.trim()) base.push(buf.trim());

  if (base.length <= 1) return base;

  // Pass 2: stitch a trimmed tail of the previous chunk onto the front of
  // each subsequent chunk.
  const overlapLen = Math.round(targetSize * overlapRatio);
  return base.map((chunk, i) => {
    if (i === 0) return chunk;
    const prevTail = base[i - 1].slice(-overlapLen);
    const spaceIdx = prevTail.indexOf(' '); // trim to a word boundary
    const cleanTail = spaceIdx > -1 ? prevTail.slice(spaceIdx + 1) : prevTail;
    return cleanTail ? `${cleanTail} … ${chunk}` : chunk;
  });
}

module.exports = { chunkText };
