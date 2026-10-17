const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
// Separate from the viewer's kiwix-serve on 8098 (see kiwix.js): that one
// serves exactly one book for the Wikipedia tab, this one serves every .zim
// the chat can search, so switching the viewer's book never interrupts a
// chat search and vice versa.
const PORT = 8099;

// Follows kiwix-serve's redirects (title aliases like "Bee Sting" → "Bee
// sting"), which are always relative paths on the same server.
function get(reqPath, timeout = 15000, hops = 3) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: HOST, port: PORT, path: reqPath, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, `http://${HOST}:${PORT}${reqPath}`).pathname, timeout, hops - 1));
        return;
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve(res.statusCode === 200 ? buf : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Turns an article page into readable blocks (headings, paragraphs, list
// items). Regex rather than a DOM parser: the app has no HTML parser
// dependency and ZIM pages are machine-generated and regular enough. Whole
// elements that are never article prose (scripts, navigation, tables,
// reference lists, figure captions) are dropped first.
function htmlToBlocks(html) {
  let h = html;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(h);
  if (body) h = body[1];
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'table', 'figure', 'sup', 'math', 'svg', 'button']) {
    h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  // Wikipedia/MediaWiki reference lists and nav boxes are <div>/<ol>, not
  // tables — cut from the references heading onward.
  h = h.replace(/<(h2|div)[^>]*(id|class)="[^"]*(References|Notes|See_also|External_links|mw-references|navbox|zim-footer)[\s\S]*$/i, '');
  // Site banners and menus come before the page title (e.g. MedlinePlus's
  // ".gov website" notice) — start at the first <h1> when there is one.
  const h1 = h.search(/<h1\b/i);
  if (h1 > 0) h = h.slice(h1);
  const raw = [];
  const re = /<(h[1-4]|p|li|dd|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(h))) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
    if (text.length < 3) continue;
    raw.push({ type: /^h/i.test(m[1]) ? 'h' : m[1].toLowerCase() === 'li' ? 'li' : 'p', text });
  }
  // List items are short on their own but often are the answer (symptom
  // lists, steps), so a run of them becomes one bulleted paragraph — joined
  // onto the sentence introducing it when that ends in a colon.
  const blocks = [];
  let skipping = false;
  for (const b of raw) {
    if (b.type === 'h') {
      skipping = SKIP_SECTIONS.test(b.text);
      if (!skipping) blocks.push({ heading: true, text: b.text });
      continue;
    }
    if (skipping) continue;
    const prev = blocks[blocks.length - 1];
    if (b.type === 'li' && prev && !prev.heading && (prev.list || /:$/.test(prev.text))) {
      prev.text += `\n• ${b.text}`;
      prev.list = true;
    } else {
      blocks.push({ heading: false, text: b.type === 'li' ? `• ${b.text}` : b.text, list: b.type === 'li' });
    }
  }
  return blocks;
}

const SKIP_SECTIONS = /^(references|sources|citations|notes|bibliography|see also|external links|further reading|related (topics|issues|information)|review date)/i;

const STOPWORDS = new Set('the a an and or of to in on for with without is are was be how what why when which do does can i my me we our you your it its this that there from by at as about into should would will get have has'.split(' '));
function terms(query) {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

class ZimSearch {
  constructor() {
    this.process = null;
    this.paths = [];   // .zim files the running process was started with
    this.books = null; // cached catalog for this.paths
  }

  isReady() {
    return new Promise((resolve) => {
      const req = http.get({ hostname: HOST, port: PORT, path: '/', timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // Serves every searchable .zim at once and filters per search by book
  // name, rather than restarting whenever the user ticks a different set:
  // kiwix-serve opens archives lazily, so all ~30 of Dave's start in ~7s
  // using ~17 MB. Only restarts when the set of files on disk changes.
  async ensureRunning(zimPaths, bin) {
    const wanted = zimPaths.map((p) => path.resolve(p)).sort();
    const same = wanted.length === this.paths.length && wanted.every((p, i) => p === this.paths[i]);
    if (this.process && same && (await this.isReady())) return true;
    if (this.process) await this.stop();
    if (!bin || !wanted.length) return false;

    this.paths = wanted;
    this.books = null;
    try {
      // --address keeps it off the local network — only this app talks to it.
      this.process = spawn(bin, ['--address=127.0.0.1', `--port=${PORT}`, ...wanted], { stdio: 'ignore', windowsHide: true });
      this.process.on('error', (err) => console.error('Failed to spawn kiwix-serve (search):', err.message));
      this.process.on('exit', () => { this.process = null; });
    } catch (err) {
      console.error('Could not start kiwix-serve (search):', err.message);
      return false;
    }
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (!this.process) return false;
      if (await this.isReady()) return true;
    }
    return false;
  }

  stop() {
    return new Promise((resolve) => {
      const proc = this.process;
      this.paths = [];
      this.books = null;
      if (!proc || proc.killed) { this.process = null; resolve(); return; }
      const done = () => { this.process = null; resolve(); };
      proc.once('exit', done);
      proc.kill();
      setTimeout(done, 2000);
    });
  }

  // [{ id, title, file, ftindex, articles }] — id is the /content/<id> name
  // that search URLs and the viewer use.
  async listBooks() {
    if (this.books) return this.books;
    const xml = await get('/catalog/v2/entries?count=500');
    if (!xml) return [];
    const books = [];
    for (const entry of xml.split('<entry>').slice(1)) {
      const id = /href="\/content\/([^"]+)"/.exec(entry)?.[1];
      if (!id) continue;
      books.push({
        id,
        title: decodeEntities(/<title>([^<]*)<\/title>/.exec(entry)?.[1] || id),
        file: this.paths.find((p) => p.replace(/\\/g, '/').endsWith(`/${id}.zim`)) || null,
        ftindex: /_ftindex:yes/.test(entry),
        articles: +(/<articleCount>(\d+)/.exec(entry)?.[1] || 0),
      });
    }
    this.books = books;
    return books;
  }

  // Hits ranked per book, then interleaved so one big book (Wikipedia)
  // can't crowd out a small specialist one (MedlinePlus) that has the
  // better answer. Books without a full-text index fall back to title
  // matching via /suggest.
  // `topic` (optional) is the main subject on its own — see parseKeywords.
  async search(query, bookIds, limit = 4, topic = null) {
    const books = (await this.listBooks()).filter((b) => bookIds.includes(b.id));
    // Filler words ("without a doctor") make the full-text search demand
    // them too and can wipe out every result in a small book.
    const pattern = query.split(/\s+/).filter((w) => !STOPWORDS.has(w.toLowerCase())).join(' ') || query;
    const perBook = await Promise.all(books.map(async (book) => {
      const hits = [];
      // Full-text ranking alone can bury the topic's own main article under
      // pages that repeat every search word (hypothermia → "Rewarming
      // shock" but not "Hypothermia"), so an article titled exactly after
      // the topic goes first. Only the topic or the whole query — matching
      // just their first word picked articles like "Treat" or "Poisonous".
      for (const phrase of [topic, query].filter(Boolean)) {
        let list = [];
        try { list = JSON.parse((await get(`/suggest?content=${encodeURIComponent(book.id)}&term=${encodeURIComponent(phrase)}&count=10`)) || '[]'); } catch { /* none */ }
        const want = phrase.toLowerCase();
        const exact = list.find((s) => s.kind === 'path' && s.path && [want, `${want}s`, want.replace(/s$/, '')].includes(decodeEntities(s.value).toLowerCase()));
        if (exact) {
          hits.push({ title: decodeEntities(exact.value), url: `/content/${book.id}/${exact.path}`, book: book.id, bookTitle: book.title });
          break;
        }
      }
      const add = (hit) => {
        if (!hits.some((h) => h.url === hit.url || h.title.toLowerCase() === hit.title.toLowerCase())) hits.push(hit);
      };
      if (book.ftindex) {
        const fullText = async (p) => {
          const xml = await get(`/search?books.name=${encodeURIComponent(book.id)}&pattern=${encodeURIComponent(p)}&format=xml&pageLength=${limit}`);
          return (xml || '').split('<item>').slice(1);
        };
        let items = await fullText(pattern);
        // Nothing for all the words together — the topic alone usually still finds something.
        if (!items.length && topic && topic !== pattern) items = await fullText(topic);
        const xml = items.map((i) => `<item>${i}`).join('');
        for (const item of (xml || '').split('<item>').slice(1)) {
          const link = /<link>([^<]+)<\/link>/.exec(item)?.[1];
          if (!link) continue;
          add({ title: decodeEntities(/<title>([^<]*)<\/title>/.exec(item)?.[1] || ''), url: decodeEntities(link), book: book.id, bookTitle: book.title });
        }
      } else {
        const json = await get(`/suggest?content=${encodeURIComponent(book.id)}&term=${encodeURIComponent(topic || pattern)}&count=${limit}`);
        let list = [];
        try { list = JSON.parse(json || '[]'); } catch { /* none */ }
        for (const s of list) {
          if (s.kind !== 'path' || !s.path) continue;
          add({ title: decodeEntities(s.value), url: `/content/${book.id}/${s.path}`, book: book.id, bookTitle: book.title });
        }
      }
      return hits.slice(0, limit);
    }));
    const out = [];
    for (let rank = 0; out.length < limit && perBook.some((h) => h[rank]); rank++) {
      for (const h of perBook) if (h[rank] && out.length < limit) out.push(h[rank]);
    }
    return out;
  }

  // The parts of one article most relevant to `query`: its opening
  // paragraph (usually the summary) plus the best-scoring paragraphs, each
  // under its section heading, in page order, capped at maxChars.
  async extract(url, query, maxChars = 1500) {
    const html = await get(url.split('#')[0]);
    if (!html) return '';
    const blocks = htmlToBlocks(html);
    const words = terms(query);
    let heading = '';
    const paras = [];
    for (const b of blocks) {
      if (b.heading) { heading = b.text; continue; }
      if (b.text.length < 40) continue;
      const lower = b.text.toLowerCase();
      const headingLower = heading.toLowerCase();
      // A paragraph under a heading that names a search word ("Treatment")
      // is usually more on-point than one that just mentions the words.
      const score = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0) + (headingLower.includes(w) ? 2 : 0), 0);
      paras.push({ heading, text: b.text, score, order: paras.length });
    }
    if (!paras.length) return '';
    const picked = [paras[0]];
    let used = paras[0].text.length;
    for (const p of paras.slice(1).filter((p) => p.score > 0).sort((a, b) => b.score - a.score)) {
      if (used + p.text.length > maxChars) continue;
      picked.push(p);
      used += p.text.length;
    }
    picked.sort((a, b) => a.order - b.order);
    let lastHeading = null;
    const lines = [];
    for (const p of picked) {
      if (p.heading && p.heading !== lastHeading) lines.push(`[${p.heading}]`);
      lastHeading = p.heading;
      lines.push(p.text);
    }
    return lines.join('\n').slice(0, maxChars + 400);
  }

  // Same { text, sources } shape as Library.buildContext, so the chat can
  // treat both the same way.
  async buildContext(query, bookIds, { limit = 4, maxCharsPerHit = 1500, topic = null } = {}) {
    if (!query || !bookIds?.length) return { text: '', sources: [], hits: [] };
    const hits = await this.search(query, bookIds, limit, topic);
    const bodies = await Promise.all(hits.map((h) => this.extract(h.url, query, maxCharsPerHit)));
    return this.assemble(hits.map((h, i) => ({ ...h, body: bodies[i] })), hits);
  }

  async assemble(articles, hits = []) {
    const files = new Map((await this.listBooks()).map((b) => [b.id, b.file]));
    const parts = [];
    const sources = [];
    const seenBodies = new Set();
    for (const a of articles) {
      // Redirects ("Bee Stings" -> "Bee sting") reach the same article under
      // another title; identical text means it's already included.
      if (!a.body || seenBodies.has(a.body)) continue;
      seenBodies.add(a.body);
      parts.push(`### ${a.title} (${a.bookTitle})\n${a.body}`);
      // file lets a click on the source open the article in the Wikipedia viewer.
      sources.push({ kind: 'zim', title: a.title, book: a.book, bookTitle: a.bookTitle, url: a.url, file: files.get(a.book) || null });
    }
    return { text: parts.join('\n\n---\n\n'), sources, hits };
  }

  // -- Quick mode: the chat model turns the question into search words, then
  // one search. `backend` is the chat runtime (ollama.js / lmstudio.js).
  async quick({ backend, model, question, previous, bookIds, options, limit = 4, maxCharsPerHit = 1500 }) {
    const raw = await backend.searchKeywords(model, keywordPrompt(question, previous), options);
    const { topic, query } = parseKeywords(raw, question);
    const result = await this.buildContext(query, bookIds, { limit, maxCharsPerHit, topic });
    return { ...result, steps: [`Searched: ${query}`], query };
  }

  // -- Thorough mode: the model drives its own research with two tools,
  // searching again with other words or opening more articles until it's
  // satisfied (or maxRounds runs out). Its own final words are thrown away —
  // the caller streams the real answer from what was opened, the same way
  // as Quick, so saving/streaming/Stop all behave identically.
  async thorough({ backend, model, question, previous, bookIds, options, onStep, maxRounds = 4, maxArticles = 5, maxCharsPerHit = 1500 }) {
    this.cancelled = false;
    const books = (await this.listBooks()).filter((b) => bookIds.includes(b.id));
    const opened = new Map(); // url -> article
    const steps = [];
    const step = (s) => { steps.push(s); onStep?.(s); };
    let lastHits = [];
    let lastQuery = question;
    const messages = [
      {
        role: 'system',
        content:
          'You are researching a question using offline reference archives before it is answered. ' +
          `Archives available: ${books.map((b) => b.title).join(', ')}.\n` +
          'Use search_zims with short keyword queries (2-5 words, main topic first), then open_article on the most promising results. ' +
          'If results are poor, search again with different words. Open at most ' + maxArticles + ' articles. ' +
          'When you have enough to answer well, reply with just the word DONE.',
      },
      ...(previous ? [{ role: 'user', content: previous }] : []),
      { role: 'user', content: question },
    ];
    for (let round = 0; round < maxRounds && !this.cancelled; round++) {
      let reply;
      try {
        reply = await backend.chatTools(model, messages, ZIM_TOOLS, options);
      } catch (err) {
        step(`Research stopped: ${err.message}`);
        break;
      }
      if (!reply.toolCalls.length) break;
      messages.push(reply.assistantMessage);
      for (const call of reply.toolCalls) {
        if (this.cancelled) break;
        let result;
        if (call.name === 'search_zims') {
          const q = cleanQuery(String(call.args?.query || '')) || question;
          lastQuery = q;
          step(`Searching: ${q}`);
          lastHits = await this.search(q, bookIds, 6);
          result = lastHits.length
            ? lastHits.map((h, i) => `${i + 1}. ${h.title} [${h.bookTitle}] url: ${h.url}`).join('\n')
            : 'No results. Try different or fewer words.';
        } else if (call.name === 'open_article') {
          const url = String(call.args?.url || '');
          const hit = lastHits.find((h) => h.url === url) || [...opened.values()].find((a) => a.url === url);
          if (!url.startsWith('/content/')) {
            result = 'Invalid url — use a url exactly as listed in search results.';
          } else if (opened.size >= maxArticles && !opened.has(url)) {
            result = 'Article limit reached. Reply DONE.';
          } else {
            const title = hit?.title || decodeURIComponent(url.split('/').pop()).replace(/_/g, ' ');
            step(`Reading: ${title}`);
            const body = await this.extract(url, `${lastQuery} ${question}`, maxCharsPerHit);
            const book = books.find((b) => url.startsWith(`/content/${b.id}/`));
            if (body) opened.set(url, { title, url, book: book?.id, bookTitle: book?.title || '', body });
            result = body || 'Could not read that article.';
          }
        } else {
          result = `Unknown tool ${call.name}.`;
        }
        messages.push(backend.toolResultMessage(call, result));
      }
      if (opened.size >= maxArticles) break;
    }
    // Searched but never opened anything (or the model ignored the tools
    // entirely): fall back to the top hits, so Thorough is never worse
    // than Quick.
    if (!opened.size && !this.cancelled) {
      if (!lastHits.length) {
        const q = await this.quick({ backend, model, question, previous, bookIds, options, maxCharsPerHit });
        return { ...q, steps: [...steps, ...q.steps] };
      }
      const bodies = await Promise.all(lastHits.slice(0, 4).map((h) => this.extract(h.url, lastQuery, maxCharsPerHit)));
      lastHits.slice(0, 4).forEach((h, i) => bodies[i] && opened.set(h.url, { ...h, body: bodies[i] }));
    }
    const result = await this.assemble([...opened.values()]);
    return { ...result, steps };
  }

  cancel() {
    this.cancelled = true;
  }

  // Every .zim directly inside the given folders (non-recursive, like the
  // existing Wikipedia folder scan), deduplicated by file name.
  static scanFolders(folders) {
    const seen = new Map();
    for (const dir of folders) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!n.toLowerCase().endsWith('.zim') || seen.has(n.toLowerCase())) continue;
        const full = path.join(dir, n); // kiwix-serve rejects mixed / and \ separators
        try { if (fs.statSync(full).size > 0) seen.set(n.toLowerCase(), full); } catch { /* skip */ }
      }
    }
    return [...seen.values()];
  }
}

const ZIM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_zims',
      description: 'Full-text search of the offline reference archives. Returns article titles with their urls.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Short keyword query, 2-5 words, main topic first' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_article',
      description: 'Read the relevant parts of one article from the search results.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The url exactly as listed in search results' } },
        required: ['url'],
      },
    },
  },
];

// The earlier question is included so a follow-up ("what about children?")
// still searches for the right topic.
function keywordPrompt(question, previous) {
  return [
    {
      role: 'system',
      content:
        'Turn the user\'s question into search words for an offline encyclopedia. Reply with one line in the form:\n' +
        'main topic | other keywords\n' +
        'The main topic is the title of the encyclopedia article most likely to answer (1-3 words). ' +
        'Other keywords are 1-3 words that narrow it down. No quotes, no explanation.\n' +
        'Examples:\n' +
        'How do I treat hypothermia with no doctor? -> Hypothermia | treatment first aid\n' +
        'Is it safe to eat raw elderberries? -> Sambucus | raw berries toxicity',
    },
    ...(previous ? [{ role: 'user', content: `Earlier question (for context): ${previous}` }] : []),
    { role: 'user', content: question },
  ];
}

// Models sometimes wrap the query in quotes, add "Query:", or think out loud
// first — keep the last non-empty line, stripped down to plain words.
function cleanQuery(raw) {
  if (!raw) return '';
  const line = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  return line.replace(/^.*->\s*/, '').replace(/^(search\s*)?query\s*:\s*/i, '').replace(/["'`*]/g, '').replace(/[.?!]+$/, '').trim().slice(0, 80);
}

// "Hypothermia | treatment first aid" -> topic "Hypothermia", query
// "Hypothermia treatment first aid". A model that ignores the format just
// gives a plain query (no topic); no reply at all searches the question.
function parseKeywords(raw, question) {
  const line = cleanQuery(raw);
  if (!line) return { topic: null, query: question };
  const [topic, rest] = line.split('|').map((s) => s.trim());
  if (rest === undefined) return { topic: null, query: topic };
  return { topic: topic || null, query: [topic, rest].filter(Boolean).join(' ') };
}

module.exports = { ZimSearch, HOST, PORT, htmlToBlocks, cleanQuery, parseKeywords };
