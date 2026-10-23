const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Used only as a last-resort fallback if every tier catalog file below is
// missing or fails to parse (e.g. a corrupted portable folder) — so the
// Models tab always has *something* to show rather than going blank.
const DEFAULT_CATALOG = {
  categories: {
    'Quick/Micro': 1,
    'General': 2,
    'Deep Think/Reasoning': 3,
    'Vision': 4,
    'Unrestricted': 5,
    'Coder': 6,
    'Creative': 7,
  },
  models: {
    'qwen2.5:0.5b': { name: 'Nano', size: '397 MB', category: 'Quick/Micro', description: 'Fastest, smallest — good for quick simple replies' },
    'llama3.2:1b': { name: 'Spark', size: '1.3 GB', category: 'Quick/Micro', description: 'Good balance for everyday chat' },
    'qwen2.5:3b': { name: 'Core', size: '1.9 GB', category: 'General', description: 'Stronger reasoning, still fast' },
    'llama3.1:8b': { name: 'Swift', size: '4.9 GB', category: 'General', description: 'High quality daily-driver model' },
    'qwen2.5:14b': { name: 'Titan', size: '9.7 GB', category: 'General', description: 'Largest general model — best quality, slower' },
    'deepseek-r1:7b': { name: 'Logic', size: '4.7 GB', category: 'Deep Think/Reasoning', description: 'Step-by-step reasoning tasks' },
    'deepseek-r1:14b': { name: 'Logic Pro', size: '9.0 GB', category: 'Deep Think/Reasoning', description: 'Deeper reasoning, larger context for hard problems' },
    'moondream:latest': { name: 'Eye', size: '1.7 GB', category: 'Vision', description: 'Fast image recognition' },
    'huihui_ai/qwen2.5-vl-abliterated:7b-instruct': { name: 'Eye Pro', size: '6.0 GB', category: 'Vision', description: 'Stronger vision + language understanding' },
    'AliBilge/Huihui-GLM-4.6V-Flash-abliterated:q4_K_M': { name: 'Unchained', size: '6.2 GB', category: 'Unrestricted', description: 'Unrestricted general chat, lower quant' },
    'AliBilge/Huihui-GLM-4.6V-Flash-abliterated:q5_k_m': { name: 'Unchained Pro', size: '7.1 GB', category: 'Unrestricted', description: 'Unrestricted general chat, higher quality quant' },
    'qwen2.5-coder:7b': { name: 'Dev', size: '4.7 GB', category: 'Coder', description: 'Code generation & debugging' },
    'fluffy/l3-8b-stheno-v3.2:q4_K_M': { name: 'Muse', size: '4.9 GB', category: 'Creative', description: 'Creative writing & roleplay' },
  },
};

// The catalog is split by GPU VRAM tier — data/4K-models-catalog.json,
// 8K, 12K, 24K, 32K — each a curated list sized for cards around that much
// VRAM. `vram` is only used to order tiers
// smallest-to-largest for the merge below and in the UI.
const TIERS = [
  { tier: '4K', vram: 4 },
  { tier: '8K', vram: 8 },
  { tier: '12K', vram: 12 },
  { tier: '24K', vram: 24 },
  { tier: '32K', vram: 32 },
];
const KNOWN_TIERS = new Set(TIERS.map((t) => t.tier));

function tierFileName(tier) { return `${tier}-models-catalog.json`; }

// Accepts either the current { categories, models } shape or the older flat
// { "model:tag": {...}, ... } shape this file used before category weights
// existed, and always returns the current shape — so a catalog file written
// before this feature shipped keeps working instead of breaking outright.
function normalizeCatalog(raw) {
  if (raw && raw.models && typeof raw.models === 'object') {
    return { categories: raw.categories && typeof raw.categories === 'object' ? raw.categories : {}, models: raw.models };
  }
  const categories = {};
  let nextWeight = 1;
  for (const info of Object.values(raw || {})) {
    const category = info?.category || 'Other';
    if (!(category in categories)) categories[category] = nextWeight++;
  }
  return { categories, models: raw || {} };
}

class ModelDownloader {
  // catalogDir is data/ — each tier's catalog file lives directly inside it.
  constructor(ollama, catalogDir) {
    this.ollama = ollama;
    this.catalogDir = catalogDir;
    this.downloads = new Map(); // modelName -> progress state
    this.emitter = new EventEmitter();
  }

  on(event, cb) { this.emitter.on(event, cb); }

  tierFilePath(tier) { return path.join(this.catalogDir, tierFileName(tier)); }

  // Every known GPU-size tier, flagged with whether its catalog file is
  // actually present on disk (so a fresh checkout missing one just shows it
  // disabled in the picker instead of erroring) plus how many models it
  // lists, for the tier picker's labels.
  listAvailableTiers() {
    return TIERS.map(({ tier, vram }) => {
      const filePath = this.tierFilePath(tier);
      let modelCount = 0;
      let available = false;
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        modelCount = Object.keys(normalizeCatalog(raw).models).length;
        available = true;
      } catch { /* missing or unparsable — surfaced per-tier by getCatalogInfo */ }
      return { tier, vram, path: filePath, available, modelCount };
    });
  }

  // Re-read on every call (cheap — these are small files) rather than
  // caching, so hand-edits to a tier's JSON are picked up next time the
  // Models tab (re)renders, no restart needed.
  readTierCatalog(tier) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.tierFilePath(tier), 'utf8'));
      return { catalog: normalizeCatalog(raw), error: null };
    } catch (err) {
      return { catalog: { categories: {}, models: {} }, error: err.message };
    }
  }

  // Combines the given tiers into one { categories, models } catalog — the
  // same shape the rest of the app (dropdown sort, catalog list rendering)
  // already expects, so selecting multiple GPU sizes is just "read more
  // files" rather than a new downstream code path. Category weights are
  // identical across tiers so merging them is a no-op in practice; each
  // model is tagged with the tier it came from so the UI can badge it.
  // Merged smallest-to-largest, so on the rare case the same model tag is
  // curated into two tiers, the larger tier's entry (name/category/description)
  // wins.
  getCatalog(selectedTiers) {
    const tiers = (selectedTiers && selectedTiers.length ? selectedTiers : TIERS.map((t) => t.tier))
      .filter((t) => KNOWN_TIERS.has(t));
    const merged = { categories: {}, models: {} };
    for (const { tier } of TIERS) {
      if (!tiers.includes(tier)) continue;
      const { catalog } = this.readTierCatalog(tier);
      Object.assign(merged.categories, catalog.categories);
      for (const [key, info] of Object.entries(catalog.models)) {
        merged.models[key] = { ...info, tier };
      }
    }
    if (Object.keys(merged.models).length === 0) return DEFAULT_CATALOG;
    return merged;
  }

  // Ollama settings measured on a card of this tier's size (see the
  // "ollamaTuning" section of e.g. data/12K-models-catalog.json):
  // { "model:tag": { context, kvCache } }. It may name models the tier's own
  // list doesn't (an installed model from a smaller tier was still measured on
  // this card). The largest selected tier that has a section wins; {} = none.
  getOllamaTuning(selectedTiers) {
    const tiers = selectedTiers && selectedTiers.length ? selectedTiers : TIERS.map((t) => t.tier);
    for (const { tier } of [...TIERS].reverse()) {
      if (!tiers.includes(tier)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(this.tierFilePath(tier), 'utf8'));
        if (raw && raw.ollamaTuning && typeof raw.ollamaTuning === 'object') return raw.ollamaTuning;
      } catch { /* missing or unparsable tier file — try the next one */ }
    }
    return {};
  }

  // Per-tier read/parse status for the given tiers, so the Models tab can
  // show each source file's own path and flag one with a JSON typo instead
  // of silently falling back for the whole combined list.
  getCatalogInfo(selectedTiers) {
    const tiers = selectedTiers && selectedTiers.length ? selectedTiers.filter((t) => KNOWN_TIERS.has(t)) : TIERS.map((t) => t.tier);
    return tiers.map((tier) => {
      const { error } = this.readTierCatalog(tier);
      return { tier, path: this.tierFilePath(tier), error };
    });
  }

  getDisplayInfo(key, selectedTiers) { return this.getCatalog(selectedTiers).models[key] || { name: key, size: '?', category: '', description: '' }; }

  getStatus() {
    const out = {};
    for (const [k, v] of this.downloads) out[k] = v;
    return out;
  }

  async pullModel(name) {
    const startTime = Date.now();
    this.downloads.set(name, { status: 'downloading', progress: 0, downloaded: 0, total: 0, speed: 0 });

    try {
      await this.ollama.pullModel(name, (evt) => {
        if (evt.error) {
          this.downloads.set(name, { status: 'error', progress: 0, error: evt.error });
          this.emitter.emit('error', { model: name, error: evt.error });
          return;
        }
        const elapsed = (Date.now() - startTime) / 1000;
        let progress = 0, downloaded = 0, total = 0, speed = 0;
        if (evt.total && evt.completed !== undefined) {
          total = evt.total;
          downloaded = evt.completed || 0;
          progress = total > 0 ? (downloaded / total) * 100 : 0;
          speed = elapsed > 0 ? downloaded / elapsed : 0;
        } else if (evt.status === 'success') {
          progress = 100;
        }
        const state = { status: progress >= 100 ? 'completed' : 'downloading', progress: Math.min(100, Math.round(progress)), downloaded, total, speed, elapsed, statusText: evt.status || '' };
        this.downloads.set(name, state);
        this.emitter.emit('progress', { model: name, ...state });
      });

      const finalState = this.downloads.get(name);
      if (finalState?.status !== 'error') {
        this.downloads.set(name, { ...finalState, status: 'completed', progress: 100 });
        this.emitter.emit('complete', { model: name });
      }
      this.downloads.delete(name);
      return { success: true };
    } catch (err) {
      this.downloads.delete(name);
      this.emitter.emit('error', { model: name, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // Pulls every catalog model (across the given tiers) not already installed,
  // one at a time.
  async startBackgroundDownloads(selectedTiers) {
    const installed = await this.ollama.getModels();
    const have = new Set(installed.map((m) => m.name));
    const missing = Object.keys(this.getCatalog(selectedTiers).models).filter((k) => !have.has(k));
    if (missing.length === 0) return { success: true, skipped: true };
    for (const name of missing) await this.pullModel(name);
    return { success: true };
  }

  cancelDownload(name) {
    // Ollama's pull endpoint doesn't expose per-request cancellation over
    // HTTP; the practical approach is to stop tracking it client-side and
    // let the connection close naturally when the renderer stops polling.
    this.downloads.delete(name);
    return true;
  }
}

module.exports = { ModelDownloader, DEFAULT_CATALOG, TIERS };
