const state = { chatId: null, model: null, streaming: false, aborting: false, ragEnabled: false, zimBooks: [], zimMode: 'quick', pendingAttachments: [], contextSize: null, keepModelsLoadedOnExit: false, backend: 'ollama', lmstudioAutoLoad: true };

// Library search always embeds with this model, regardless of whatever chat
// model is currently selected — every stored doc/chunk embedding is built
// with nomic-embed-text, so queries must use the same model to be
// comparable with them.
const LIBRARY_EMBED_MODEL = 'nomic-embed-text';

const els = {
  chatList: document.getElementById('chat-list'),
  messages: document.getElementById('messages'),
  scrollTopBtn: document.getElementById('scroll-top-btn'),
  modelSelect: document.getElementById('model-select'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  modelLoadDot: document.getElementById('model-load-dot'),
  modelLoadText: document.getElementById('model-load-text'),
  modelLoadBtn: document.getElementById('model-load-btn'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  newChat: document.getElementById('new-chat'),
  clearChats: document.getElementById('clear-chats'),
  exportChat: document.getElementById('export-chat'),
  micBtn: document.getElementById('mic-btn'),
  ragToggle: document.getElementById('rag-toggle'),
  zimToggle: document.getElementById('zim-toggle'),
  zimPicker: document.getElementById('zim-picker'),
  zimPickerList: document.getElementById('zim-picker-list'),
  zimPickerNote: document.getElementById('zim-picker-note'),
  zimPickerNone: document.getElementById('zim-picker-none'),
  zimPickerDone: document.getElementById('zim-picker-done'),
  zimSummary: document.getElementById('zim-summary'),
  zimSummaryText: document.getElementById('zim-summary-text'),
  zimSummaryChange: document.getElementById('zim-summary-change'),
  zimSummaryClear: document.getElementById('zim-summary-clear'),
  zimFolderList: document.getElementById('zim-folder-list'),
  zimFolderAdd: document.getElementById('zim-folder-add'),
  themeToggle: document.getElementById('theme-toggle'),
  attachBtn: document.getElementById('attach-btn'),
  attachFile: document.getElementById('attach-file'),
  attachmentsRow: document.getElementById('attachments-row'),

  exitApp: document.getElementById('exit-app'),
  shutdownOverlay: document.getElementById('shutdown-overlay'),
  shutdownMessage: document.getElementById('shutdown-message'),

  appModalOverlay: document.getElementById('app-modal-overlay'),
  appModalMessage: document.getElementById('app-modal-message'),
  appModalOk: document.getElementById('app-modal-ok'),
  appModalCancel: document.getElementById('app-modal-cancel'),
  appModalCheckboxRow: document.getElementById('app-modal-checkbox-row'),
  appModalCheckbox: document.getElementById('app-modal-checkbox'),
  appModalCheckboxLabel: document.getElementById('app-modal-checkbox-label'),
  appModalInput: document.getElementById('app-modal-input'),

  openTools: document.getElementById('open-tools'),
  closeTools: document.getElementById('close-tools'),
  toolsOverlay: document.getElementById('tools-overlay'),
  openLibraryView: document.getElementById('open-library-view'),
  libraryBackToChat: document.getElementById('library-back-to-chat'),
  chatView: document.getElementById('chat-view'),
  libraryView: document.getElementById('library-view'),

  openAnalyzeView: document.getElementById('open-analyze-view'),
  analyzeBackToChat: document.getElementById('analyze-back-to-chat'),
  analyzeView: document.getElementById('analyze-view'),
  analyzeDropzone: document.getElementById('analyze-dropzone'),
  analyzeBrowseBtn: document.getElementById('analyze-browse-btn'),
  analyzeFileInput: document.getElementById('analyze-file-input'),
  analyzeWorkspace: document.getElementById('analyze-workspace'),
  analyzePreview: document.getElementById('analyze-preview'),
  analyzeNoVisionModel: document.getElementById('analyze-no-vision-model'),
  analyzeModelRow: document.getElementById('analyze-model-row'),
  analyzeModelSelect: document.getElementById('analyze-model-select'),
  analyzeRunBtn: document.getElementById('analyze-run-btn'),
  analyzeResetBtn: document.getElementById('analyze-reset-btn'),
  analyzeResults: document.getElementById('analyze-results'),
  analyzeSources: document.getElementById('analyze-sources'),
  analyzeAnswer: document.getElementById('analyze-answer'),

  openTranslateView: document.getElementById('open-translate-view'),
  translateBackToChat: document.getElementById('translate-back-to-chat'),
  translateView: document.getElementById('translate-view'),

  translateTextInput: document.getElementById('translate-text-input'),
  translateTextModelHint: document.getElementById('translate-text-model-hint'),
  translateTextModelSelect: document.getElementById('translate-text-model-select'),
  translateDropzone: document.getElementById('translate-dropzone'),
  translateBrowseBtn: document.getElementById('translate-browse-btn'),
  translateFileInput: document.getElementById('translate-file-input'),
  translateImageWorkspace: document.getElementById('translate-image-workspace'),
  translatePreview: document.getElementById('translate-preview'),
  translateNoVisionModel: document.getElementById('translate-no-vision-model'),
  translateModelRow: document.getElementById('translate-model-row'),
  translateModelSelect: document.getElementById('translate-model-select'),
  translateRemoveImageBtn: document.getElementById('translate-remove-image-btn'),
  translateLangSelect: document.getElementById('translate-lang-select'),
  translateTargetLang: document.getElementById('translate-target-lang'),
  translateRunBtn: document.getElementById('translate-run-btn'),
  translateResults: document.getElementById('translate-results'),
  translateAnswer: document.getElementById('translate-answer'),
  tabs: [...document.querySelectorAll('.tab')],
  panels: [...document.querySelectorAll('.tab-panel')],

  catalogList: document.getElementById('catalog-list'),
  catalogTiersList: document.getElementById('catalog-tiers-list'),
  contextSizeList: document.getElementById('context-size-list'),
  contextSizeNote: document.getElementById('context-size-note'),
  backendList: document.getElementById('backend-list'),
  backendLmstudioOptions: document.getElementById('backend-lmstudio-options'),
  backendLmstudioStatus: document.getElementById('backend-lmstudio-status'),
  backendLmstudioAutoload: document.getElementById('backend-lmstudio-autoload'),
  backendLmstudioThinking: document.getElementById('backend-lmstudio-thinking'),
  backendVisionOllama: document.getElementById('backend-vision-ollama'),
  catalogFileInfoList: document.getElementById('catalog-file-info-list'),
  modelsLocationInfo: document.getElementById('models-location-info'),
  modelsChooseFolder: document.getElementById('models-choose-folder'),
  modelsUsePortable: document.getElementById('models-use-portable'),
  modelsSyncToHost: document.getElementById('models-sync-to-host'),
  modelsSyncToPortable: document.getElementById('models-sync-to-portable'),
  modelsSyncStatus: document.getElementById('models-sync-status'),

  libraryFile: document.getElementById('library-file'),
  libraryUploadCategory: document.getElementById('library-upload-category'),
  libraryNewCategoryInput: document.getElementById('library-new-category-input'),
  libraryQuery: document.getElementById('library-query'),
  librarySearchBtn: document.getElementById('library-search-btn'),
  libraryResults: document.getElementById('library-results'),
  libraryUploads: document.getElementById('library-uploads'),
  researchStatus: document.getElementById('research-status'),
  researchProgress: document.getElementById('research-progress'),
  researchSyncBtn: document.getElementById('research-sync-btn'),
  researchPauseBtn: document.getElementById('research-pause-btn'),
  researchChooseBtn: document.getElementById('research-choose-btn'),
  researchRemoveBtn: document.getElementById('research-remove-btn'),
  libraryResetBtn: document.getElementById('library-reset-btn'),
  researchNotice: document.getElementById('research-notice'),
  researchNoticeText: document.getElementById('research-notice-text'),
  researchNoticeSync: document.getElementById('research-notice-sync'),
  researchNoticeDismiss: document.getElementById('research-notice-dismiss'),

  browserListView: document.getElementById('browser-list-view'),
  browserDocView: document.getElementById('browser-doc-view'),
  browserQuery: document.getElementById('browser-query'),
  browserCategory: document.getElementById('browser-category'),
  browserSource: document.getElementById('browser-source'),
  browserSearchBtn: document.getElementById('browser-search-btn'),
  browserResults: document.getElementById('browser-results'),
  browserLoadMore: document.getElementById('browser-load-more'),
  browserBackBtn: document.getElementById('browser-back-btn'),
  browserDocTitle: document.getElementById('browser-doc-title'),
  browserDocMeta: document.getElementById('browser-doc-meta'),
  browserOpenPdfBtn: document.getElementById('browser-open-pdf-btn'),
  browserPdfControls: document.getElementById('browser-pdf-controls'),
  browserViewPdfBtn: document.getElementById('browser-view-pdf-btn'),
  browserViewTextBtn: document.getElementById('browser-view-text-btn'),
  browserDocImages: document.getElementById('browser-doc-images'),
  browserDocBody: document.getElementById('browser-doc-body'),
  pdfViewerWrap: document.getElementById('pdf-viewer-wrap'),

  mobileStatus: document.getElementById('mobile-status'),
  mobileToggle: document.getElementById('mobile-toggle'),

  systemInfo: document.getElementById('system-info'),
  ollamaLogRefresh: document.getElementById('ollama-log-refresh'),
  ollamaLogView: document.getElementById('ollama-log-view'),
};

// Converts an ArrayBuffer to base64. Deliberately NOT
// `btoa(String.fromCharCode(...bytes))` — spreading a typed array into a
// function call passes every byte as a separate argument, and V8 throws
// "RangeError: Maximum call stack size exceeded" somewhere between ~100KB
// and ~1MB of input (confirmed empirically: 100,000 bytes is fine, 1,000,000
// throws). That silently aborted attaching any real photo (a phone/camera
// JPEG is almost always well over 1MB) while a tiny image kept working,
// which is exactly the "some files just do nothing" bug this fixes.
// Chunking well under that limit keeps this correct at any file size.
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============================================================ app modal
// Stands in for native alert()/confirm() everywhere in this file. Electron
// can't reposition those — they're rendered by the OS/Chromium as their own
// dialog, wherever it defaults to, not necessarily over this window. A
// plain in-page overlay is trivially centered in the app's own viewport by
// ordinary CSS instead.
let modalKeyHandler = null;

// Resolves { ok, checked } — `checked` is only meaningful when checkboxLabel
// was passed (undefined otherwise). showAppAlert/showAppConfirm below unwrap
// this to a plain boolean for the common case; callers that need the
// checkbox (the exit-confirmation dialog) use showAppModal directly.
// `inputPlaceholder`, when given, shows a one-line text box (its value comes
// back as `value`) — used for "type RESET to confirm".
function showAppModal(message, { cancel = false, okText = 'OK', cancelText = 'Cancel', checkboxLabel = null, checkboxChecked = false, inputPlaceholder = null } = {}) {
  return new Promise((resolve) => {
    els.appModalMessage.textContent = message;
    const hasInput = inputPlaceholder !== null;
    els.appModalInput.classList.toggle('hidden', !hasInput);
    els.appModalInput.value = '';
    els.appModalInput.placeholder = inputPlaceholder || '';
    els.appModalOk.textContent = okText;
    els.appModalCancel.classList.toggle('hidden', !cancel);
    els.appModalCancel.textContent = cancelText;
    const hasCheckbox = !!checkboxLabel;
    els.appModalCheckboxRow.classList.toggle('hidden', !hasCheckbox);
    if (hasCheckbox) {
      els.appModalCheckboxLabel.textContent = checkboxLabel;
      els.appModalCheckbox.checked = checkboxChecked;
    }
    els.appModalOverlay.classList.remove('hidden');
    (hasInput ? els.appModalInput : els.appModalOk).focus();

    const finish = (ok) => {
      const checked = hasCheckbox ? els.appModalCheckbox.checked : undefined;
      const value = hasInput ? els.appModalInput.value : undefined;
      els.appModalOverlay.classList.add('hidden');
      els.appModalOk.onclick = null;
      els.appModalCancel.onclick = null;
      document.removeEventListener('keydown', modalKeyHandler);
      modalKeyHandler = null;
      resolve({ ok, checked, value });
    };
    els.appModalOk.onclick = () => finish(true);
    els.appModalCancel.onclick = () => finish(false);
    modalKeyHandler = (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(cancel ? false : true); // no Cancel button on a plain alert — Escape just dismisses it
    };
    document.addEventListener('keydown', modalKeyHandler);
  });
}
const showAppAlert = (message) => showAppModal(message, { cancel: false }).then((r) => r.ok);
const showAppConfirm = (message) => showAppModal(message, { cancel: true }).then((r) => r.ok);

// ============================================================ theme
// theme-init.js (loaded in <head>, ahead of this file) already applied any
// saved theme to <html data-theme="..."> before first paint — this just
// syncs the toggle button's icon/title to whatever that ended up being, and
// handles clicks from here on.
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  els.themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
  els.themeToggle.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  try { localStorage.setItem('theme', theme); } catch { /* per-viewer convenience only */ }
}
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
els.themeToggle.onclick = () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
};

// ============================================================ chat core
// Model replies shown as formatted text (bold, lists, headings, code) rather
// than raw **markdown**. A separate Marked instance, so the Reference
// Library's own rendering is untouched. Model output is untrusted: raw HTML
// is shown as text, links don't navigate (clicking one would take the whole
// app window off to that page), and images aren't fetched.
function escapeReplyHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const replyMarked = window.marked?.Marked
  ? new window.marked.Marked({
    gfm: true,
    breaks: true, // a single newline stays a line break, as in the plain-text display
    renderer: {
      // <br> is the one tag models routinely use (line breaks inside table cells) — harmless, so kept.
      html: (html) => (/^\s*<br\s*\/?>\s*$/i.test(html) ? '<br>' : escapeReplyHtml(html)),
      link: (href, title, text) => `<span class="md-link" title="${escapeReplyHtml(href)}">${text}</span>`,
      image: (href, title, text) => (text ? escapeReplyHtml(`[image: ${text}]`) : ''),
    },
  })
  : null;

function renderReply(el, text) {
  if (!replyMarked) { el.textContent = text; return; }
  el.classList.add('md');
  el.innerHTML = replyMarked.parse(text || '');
}

// Streaming re-renders the whole reply on each token — batched to one render
// per animation frame so a fast model doesn't re-parse hundreds of times a second.
function replyRenderer(el, onRendered) {
  let pending = null;
  return (text) => {
    if (pending === null) {
      requestAnimationFrame(() => { renderReply(el, pending); pending = null; onRendered?.(); });
    }
    pending = text;
  };
}

function addMessageEl(role, content, attachments) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'assistant') {
    const label = document.createElement('span');
    label.className = 'role-label';
    label.textContent = state.model || 'assistant';
    div.appendChild(label);
  }
  if (attachments?.length) {
    const row = document.createElement('div');
    row.className = 'msg-attachments';
    for (const a of attachments) row.appendChild(renderAttachmentChip(a, { large: true }));
    div.appendChild(row);
  }
  const body = document.createElement('div');
  if (role === 'assistant') renderReply(body, content);
  else body.textContent = content;
  div.appendChild(body);
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return body;
}

function clearEmptyState() {
  const empty = els.messages.querySelector('.empty-state');
  if (empty) empty.remove();
}

// Floating "scroll to top" button — only useful once you've actually
// scrolled down away from the top, so it stays hidden until then rather
// than sitting there uselessly on a short conversation.
els.messages.addEventListener('scroll', () => {
  els.scrollTopBtn.classList.toggle('hidden', els.messages.scrollTop < 200);
});
els.scrollTopBtn.onclick = () => els.messages.scrollTo({ top: 0, behavior: 'smooth' });

// Converts a catalog "size" string ("397 MB", "1.3 GB", ...) to MB for
// numeric comparison. Unparseable or missing sizes sort last (Infinity) —
// same convention as an unweighted category.
function parseSizeToMB(sizeStr) {
  const match = /([\d.]+)\s*(KB|MB|GB|TB)/i.exec(sizeStr || '');
  if (!match) return Infinity;
  const multiplier = { KB: 1 / 1024, MB: 1, GB: 1024, TB: 1024 * 1024 }[match[2].toUpperCase()];
  return parseFloat(match[1]) * multiplier;
}

// Sorts installed models for the dropdown by their category's weight (from
// the merged GPU-tier catalogs' `categories` map — lower shows first), a model
// whose category has no weight (or isn't in the catalog at all, e.g. an
// embedding model) sorting after every weighted one. Ties — same weight,
// including two categories deliberately given equal weight — fall back to
// alphabetical by category name; *within* a category, models are then
// ordered smallest-first by size, with the model id as a final alphabetical
// tie-break if sizes are equal or unparseable. Every tie-break is local to
// whatever group is actually tied, not a full re-sort of the list.
function sortModelsByCategoryWeight(models, catalog) {
  const catModels = catalog.models || {};
  const catWeights = catalog.categories || {};
  const infoFor = (m) => catModels[m.name];
  const weightFor = (m) => {
    const category = infoFor(m)?.category;
    return category && category in catWeights ? catWeights[category] : Infinity;
  };
  return [...models].sort((a, b) => {
    const weightDiff = weightFor(a) - weightFor(b);
    if (weightDiff !== 0) return weightDiff;
    const catDiff = (infoFor(a)?.category || '').localeCompare(infoFor(b)?.category || '');
    if (catDiff !== 0) return catDiff;
    const sizeDiff = parseSizeToMB(infoFor(a)?.size) - parseSizeToMB(infoFor(b)?.size);
    if (sizeDiff !== 0) return sizeDiff;
    return a.name.localeCompare(b.name);
  });
}

// Prefer the currently-selected GPU tier(s)' catalog entry for each model
// (name/category/size/tier), but fall back to any other tier's entry for an
// already-installed model whose tier isn't currently selected — so
// switching the GPU size picker never strips a still-installed model of its
// catalog prefix/size or knocks it out of category/size order. Shared by
// every dropdown that lists installed models (chat, Analyze Image, Translate)
// so they all read the same way.
async function getMergedCatalog() {
  const [selectedCatalog, allTiersCatalog] = await Promise.all([
    window.localAI.getCatalog(),
    window.localAI.getCatalogAllTiers(),
  ]);
  return {
    categories: { ...allTiersCatalog.categories, ...selectedCatalog.categories },
    models: { ...allTiersCatalog.models, ...selectedCatalog.models },
  };
}

// "General — qwen2.5:3b (1.9 GB)" — prefixed with category so a dropdown
// reads at a glance, sized at the end; a model outside every catalog tier
// (e.g. an embedding model) just shows its plain name, since there's no
// catalog entry to pull from. `tiersInPlay` only adds a "[tier]" tag when
// the list being built actually mixes GPU tiers — otherwise every entry
// would share one tier and the tag would just be noise.
function modelOptionLabel(name, catalog, tiersInPlay) {
  const info = catalog.models?.[name];
  const tierTag = info?.tier && tiersInPlay.size > 1 ? ` [${info.tier}]` : '';
  return info ? `${info.category} — ${name} (${info.size})${tierTag}` : name;
}

async function refreshModels() {
  const [models, catalog] = await Promise.all([window.localAI.listModels(), getMergedCatalog()]);
  els.modelSelect.innerHTML = '';
  if (models.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = state.backend === 'lmstudio'
      ? 'No models found in LM Studio — is its local server running?'
      : 'No models pulled yet — open Tools → Models';
    els.modelSelect.appendChild(opt);
    els.send.disabled = true;
    state.model = null;
    return;
  }
  const sorted = sortModelsByCategoryWeight(models, catalog);
  const tiersInPlay = new Set(sorted.map((m) => catalog.models?.[m.name]?.tier).filter(Boolean));
  for (const m of sorted) {
    const opt = document.createElement('option');
    opt.value = m.name;
    // LM Studio models carry their own display name; Ollama ones are
    // labeled from the catalog.
    opt.textContent = m.label || modelOptionLabel(m.name, catalog, tiersInPlay);
    els.modelSelect.appendChild(opt);
  }
  // Keep the current pick across refreshes (e.g. a runtime switch back and
  // forth); in LM Studio, otherwise prefer a model that's already loaded.
  const keep = sorted.find((m) => m.name === state.model) || sorted.find((m) => m.loaded) || sorted[0];
  state.model = keep.name;
  els.modelSelect.value = state.model;
  window.localAI.setCurrentModel(state.model);
  els.send.disabled = false;
}

async function refreshChatList() {
  const chats = await window.localAI.listChats();
  els.clearChats.disabled = chats.length === 0;
  els.chatList.innerHTML = '';
  for (const c of chats) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === state.chatId ? ' active' : '');

    const title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = c.title;
    title.onclick = () => openChat(c.id);
    item.appendChild(title);

    const rename = document.createElement('button');
    rename.className = 'chat-rename';
    rename.title = 'Rename chat';
    rename.textContent = '✎';
    rename.onclick = (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.className = 'chat-rename-input';
      input.value = c.title;
      item.replaceChild(input, title);
      rename.remove();
      input.focus();
      input.select();
      let committed = false;
      const commit = async () => {
        if (committed) return;
        committed = true;
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== c.title) await window.localAI.renameChat(c.id, newTitle);
        refreshChatList();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { committed = true; refreshChatList(); }
      });
      input.addEventListener('blur', commit);
    };
    item.appendChild(rename);

    const del = document.createElement('button');
    del.className = 'chat-delete';
    del.title = 'Delete chat';
    del.textContent = '×';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!(await showAppConfirm(`Delete "${c.title}"? This can't be undone.`))) return;
      await window.localAI.deleteChat(c.id);
      if (state.chatId === c.id) {
        state.chatId = null;
        els.messages.innerHTML = `<div class="empty-state"><p>Nothing runs anywhere but this machine.</p><p class="empty-sub">Pick a model above and start a conversation.</p></div>`;
        els.scrollTopBtn.classList.add('hidden');
      }
      refreshChatList();
    };
    item.appendChild(del);

    els.chatList.appendChild(item);
  }
}

async function openChat(chatId) {
  state.chatId = chatId;
  applyChatZimSettings(chatId);
  const history = await window.localAI.getHistory(chatId);
  els.messages.innerHTML = '';
  els.scrollTopBtn.classList.add('hidden');
  if (history.length === 0) {
    els.messages.innerHTML = `<div class="empty-state"><p>Nothing runs anywhere but this machine.</p><p class="empty-sub">Pick a model above and start a conversation.</p></div>`;
  } else {
    for (const m of history) addMessageEl(m.role, m.content);
  }
  refreshChatList();
}

els.newChat.onclick = async () => {
  const { id } = await window.localAI.createChat();
  await openChat(id);
};

els.clearChats.onclick = async () => {
  if (!(await showAppConfirm('Delete all chats? This removes every conversation and can\'t be undone.'))) return;
  await window.localAI.clearAllChats();
  state.chatId = null;
  els.messages.innerHTML = `<div class="empty-state"><p>Nothing runs anywhere but this machine.</p><p class="empty-sub">Pick a model above and start a conversation.</p></div>`;
  els.scrollTopBtn.classList.add('hidden');
  refreshChatList();
};

els.exportChat.onclick = async () => {
  if (!state.chatId) return;
  const chats = await window.localAI.listChats();
  const chat = chats.find((c) => c.id === state.chatId);
  await window.localAI.exportChat(state.chatId, chat?.title || 'chat');
};

els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.composer.requestSubmit(); }
});

// Rough chars-per-token approximation for English text — there's no local
// tokenizer available (Ollama does the real tokenization server-side), and
// this is deliberately conservative (assumes MORE tokens than reality) so
// budgeting below errs toward trimming a bit too much rather than risking
// the context overflow it exists to prevent.
const CHARS_PER_TOKEN_ESTIMATE = 3.5;
function estimateTokens(str) { return Math.ceil((str || '').length / CHARS_PER_TOKEN_ESTIMATE); }

// Ollama's own vram-based auto default has been observed as low as 4096 on
// real hardware in this app (see the qwen3-vl investigation) — used only to
// size the *local* history-trimming budget below when nothing more specific
// (a user-set context size, or this request's own attachment-driven bump)
// is available. It is never sent to Ollama itself as an actual num_ctx
// override; the "Auto" case still means "let Ollama decide" for real.
const AUTO_CONTEXT_ASSUMPTION = 4096;

// Keeps as much of the most recent history as fits in `tokenBudget`,
// dropping the oldest messages first — the whole conversation is resent on
// every turn with no other limit, so on a long chat this is what stands
// between a normal reply and silently exhausting the context the same way
// a big image or document attachment can (see the num_ctx comment below).
// Always keeps at least the single most recent message if there's any
// budget left at all, even if it alone doesn't fully fit — better to hand
// the model one truncated-feeling turn of context than none.
function trimHistoryToBudget(history, tokenBudget) {
  if (tokenBudget <= 0) return [];
  const kept = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 4; // +4: rough per-message role/formatting overhead
    if (used + cost > tokenBudget && kept.length > 0) break;
    used += cost;
    kept.unshift(history[i]);
  }
  return kept;
}

els.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  const attachments = state.pendingAttachments;
  if ((!text && attachments.length === 0) || state.streaming || !state.model) return;

  const images = attachments.filter((a) => a.kind === 'image');
  if (images.length) {
    const caps = await window.localAI.getModelCapabilities(state.model);
    if (!caps.vision) {
      await showAppAlert(`"${state.model}" doesn't support image input. Switch to a vision model (e.g. moondream, llava) or remove the attached image(s).`);
      return;
    }
  }

  // LM Studio with auto-load off: the model must already be loaded there.
  // Checked up front so nothing (chat creation, library lookup) happens first.
  if (state.backend === 'lmstudio' && !state.lmstudioAutoLoad) {
    const running = await window.localAI.getRunningModels();
    if (!running.some((m) => m.name === state.model)) {
      await showAppAlert(`"${els.modelSelect.selectedOptions[0]?.textContent || state.model}" isn't loaded in LM Studio.\n\nLoad it in LM Studio first, or turn on "Auto-load" in Tools → Models.`);
      return;
    }
  }

  if (!state.chatId) {
    const { id } = await window.localAI.createChat();
    state.chatId = id;
  }

  clearEmptyState();
  addMessageEl('user', text, attachments);
  els.input.value = '';
  els.input.style.height = 'auto';
  clearAttachments();

  // If RAG is on, fetch matching library context *before* streaming starts
  // so we can show "Using: ..." above the reply and have the context ready
  // to prepend to the model's messages. When an image is attached, first ask
  // the (already vision-capable, checked above) model to identify it in a
  // short phrase and fold that into the search query — otherwise a
  // photo-only message (no typed text) would search the library with an
  // empty query and never find anything, e.g. a photo of a mushroom with no
  // caption should still surface that mushroom's edibility info.
  let contextResult = { text: '', sources: [] };
  let identifiedAs = null;
  if (state.ragEnabled) {
    let ragQuery = text;
    if (images.length) {
      // Matches the num_ctx the actual send below will use whenever an image
      // is attached (needsContextBump is unconditionally true in that case —
      // see its definition further down) — giving this identify call a
      // different context size than the real send would force Ollama to
      // reload the same model a second time for no reason (num_ctx is part
      // of a model's KV-cache allocation at load time, not just a request
      // parameter).
      identifiedAs = await window.localAI.libraryIdentifyImage(state.model, images[0].base64, { num_ctx: Math.max(state.contextSize || 0, 16384) });
      if (identifiedAs) ragQuery = text ? `${identifiedAs}. ${text}` : identifiedAs;
    }
    if (ragQuery) contextResult = await window.localAI.libraryContext(ragQuery, LIBRARY_EMBED_MODEL);
  }

  const streamId = `s_${Date.now()}`;
  const assistantBody = addMessageEl('assistant', '');
  // A bouncing-dots placeholder (plus an elapsed-time label) fills the reply
  // bubble until the first token streams back. That gap can legitimately be
  // long — a model not yet resident needs loading into RAM/VRAM, and a
  // vision model encoding a large image can take well over a minute — and
  // without a visible clock, a slow-but-working reply is indistinguishable
  // from a hung one. pendingInterval is cleared the moment a token arrives
  // below, with a second clearInterval after the request settles as a
  // safety net for a zero-token completion or error.
  assistantBody.classList.add('pending');
  const hasDocAttachment = attachments.some((a) => a.kind === 'text');
  let pendingLabel = images.length ? 'Processing image' : hasDocAttachment ? 'Processing document' : 'Waiting for model';
  assistantBody.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span><span class="pending-timer">${pendingLabel}…</span>`;
  const pendingTimerEl = assistantBody.querySelector('.pending-timer');
  let pendingStart = Date.now();
  const phase = (label) => { pendingLabel = label; pendingStart = Date.now(); pendingTimerEl.textContent = `${label}…`; };
  currentPendingPhase = phase;
  const pendingInterval = setInterval(() => {
    pendingTimerEl.textContent = `${pendingLabel}… ${Math.floor((Date.now() - pendingStart) / 1000)}s`;
  }, 1000);
  let full = '';
  let firstToken = true;
  state.streaming = true;
  state.aborting = false;
  setSendButtonMode('stop');

  // ZIM archives: searched after the reply bubble exists so the search steps
  // ("Searching: …", "Reading: …") can show live in it, and after the Stop
  // button is live so a slow Thorough search can be cancelled.
  const zimQuestion = text || identifiedAs;
  if (state.zimBooks.length && zimQuestion) {
    // Same num_ctx as the reply below (ZIM text always triggers the 16K
    // bump), so the model isn't reloaded between research and answer.
    const zimOptions = { num_ctx: await fitResidentCtx(chatNumCtx()) };
    // Load the model as its own visible step — otherwise its load time hides
    // inside "Searching" (the keyword step is the model's first use). A
    // no-op when it's already loaded with this context size.
    if ((await modelResidency()) !== 'loaded') {
      phase('Loading model');
      setModelLoadState('loading');
    }
    await window.localAI.loadChatModel({ model: state.model, options: zimOptions, zim: true });
    setModelLoadState('loaded');
    phase('Searching ZIM archives');
    const stopSteps = window.localAI.onZimStep((step) => phase(step));
    const prior = await window.localAI.getHistory(state.chatId);
    const previous = [...prior].reverse().find((m) => m.role === 'user')?.content?.slice(0, 300) || null;
    saveZimSettings();
    let zim = { text: '', sources: [], steps: [] };
    try {
      zim = await window.localAI.zimContext({ model: state.model, question: zimQuestion, previous, books: state.zimBooks, mode: state.zimMode, options: zimOptions });
    } catch (err) {
      zim.steps = [`ZIM search failed: ${ipcErrorText(err)}`];
    }
    stopSteps();
    phase('Thinking');
    if (state.aborting) {
      clearInterval(pendingInterval);
      assistantBody.parentElement.remove();
      state.streaming = false;
      state.aborting = false;
      setSendButtonMode('send');
      return;
    }
    if (zim.text) {
      contextResult = {
        text: [contextResult.text, zim.text].filter(Boolean).join('\n\n---\n\n'),
        sources: [...contextResult.sources, ...zim.sources],
      };
    }
    const stepsTag = document.createElement('div');
    stepsTag.className = 'sources-tag';
    stepsTag.textContent = `🗃️ ${zim.fellBack ? 'Thorough needs a tool-calling model — used Quick. ' : ''}${zim.steps.join(' → ') || 'Searched'}${zim.sources.length ? '' : ' — nothing found'}`;
    assistantBody.parentElement.insertBefore(stepsTag, assistantBody);
  }

  if (contextResult.sources.length) {
    const tag = document.createElement('div');
    tag.className = 'sources-tag';
    const prefix = identifiedAs ? `Identified as "${identifiedAs}" — using: ` : 'Using: ';
    tag.append(prefix);
    contextResult.sources.forEach((s, i) => {
      if (i) tag.append(', ');
      tag.appendChild(sourceLink(s));
    });
    assistantBody.parentElement.insertBefore(tag, assistantBody);
  }
  // Only claim "Loading model" when it really isn't resident (with the
  // context size this request uses) — a loaded model is just thinking.
  if ((await modelResidency()) === 'loaded') {
    setModelLoadState('loaded');
    if (pendingLabel === 'Waiting for model') { pendingLabel = 'Thinking'; pendingTimerEl.textContent = 'Thinking…'; }
  } else {
    setModelLoadState('loading');
  }

  const showReply = replyRenderer(assistantBody, () => { els.messages.scrollTop = els.messages.scrollHeight; });
  const unsubscribe = window.localAI.onChatToken((data) => {
    if (data.streamId !== streamId) return;
    const token = data.message?.content;
    if (token) {
      if (firstToken) {
        firstToken = false;
        clearInterval(pendingInterval);
        assistantBody.classList.remove('pending');
        assistantBody.innerHTML = '';
        setModelLoadState('loaded'); // it streamed a token, so it must be resident now
      }
      full += token;
      showReply(full);
    }
  });

  const history = await window.localAI.getHistory(state.chatId);
  const isFirstExchange = history.length === 0;

  // Text-like attachments (PDF/Word/plain text) get their extracted text
  // folded into the user turn's content — works with any model. Images go
  // on a separate `images` field per Ollama's multimodal chat API, only
  // meaningful for vision-capable models (checked above).
  const docAttachments = attachments.filter((a) => a.kind === 'text' && a.text);
  let outgoingContent = text;
  if (docAttachments.length) {
    const blocks = docAttachments.map((a) => `### ${a.name}\n${a.text.slice(0, 6000)}`).join('\n\n---\n\n');
    outgoingContent = `${text}\n\n[Attached file contents]\n${blocks}`;
  }
  const userMsg = { role: 'user', content: outgoingContent };
  if (images.length) userMsg.images = images.map((a) => a.base64);

  // Ollama's own vram-based default context can be as little as 4096 —
  // easily eaten by a high-res image, a document attachment (up to 6000
  // chars each, uncapped count), RAG context (up to ~6000 chars), or just a
  // long chat history, any of which can leave a "thinking" model (DeepSeek-R1
  // et al) no room to write a visible answer after reasoning through the
  // input — it silently truncates with done_reason "length" and zero output.
  // 16384 was verified against a real 2731x3641 photo that otherwise
  // produced nothing but hidden `thinking` tokens; the same risk applies to
  // any of these other "extra content" sources, so they get the same bump.
  // A user-configured context size (Models tab) is always honored as a
  // floor — attachments can still raise it further above that floor, never
  // below it, so a deliberately small setting on a tiny GPU doesn't quietly
  // get ignored, but also doesn't starve a request that genuinely needs more.
  const needsContextBump = images.length || docAttachments.length || Boolean(contextResult.text) || state.ragEnabled || state.zimBooks.length > 0;
  const effectiveCtx = await fitResidentCtx(needsContextBump ? Math.max(state.contextSize || 0, 16384) : state.contextSize);
  const options = effectiveCtx ? { num_ctx: effectiveCtx } : undefined;

  // History budget: whatever the request will actually use for context
  // (falling back to AUTO_CONTEXT_ASSUMPTION for planning purposes when
  // nothing overrides Ollama's own auto-sizing), minus room reserved for the
  // model's own reply (including any hidden "thinking") and this turn's own
  // content, leaves what's available for prior messages. Oldest messages
  // are dropped first — see trimHistoryToBudget above.
  const budgetCtx = effectiveCtx || AUTO_CONTEXT_ASSUMPTION;
  const reservedForReply = Math.min(2048, Math.floor(budgetCtx * 0.3));
  const currentTurnTokens = estimateTokens(outgoingContent) + estimateTokens(contextResult.text) + 32;
  const historyBudget = Math.max(0, budgetCtx - reservedForReply - currentTurnTokens);
  const trimmedHistory = trimHistoryToBudget(history, historyBudget);
  const omittedCount = history.length - trimmedHistory.length;

  let messages = [...trimmedHistory, userMsg];
  if (contextResult.text) {
    // Prepended, not saved: chat:send only persists the last (user)
    // message, so this context doesn't bloat stored history or get
    // re-sent stale on a later turn — it's rebuilt fresh from the current
    // library state every time.
    messages = [
      {
        role: 'system',
        content: `Use the following context from the user's local library and offline reference archives if it's relevant to their question. Mention which source(s) you drew from if you use them.\n\n${contextResult.text}`,
      },
      ...messages,
    ];
  }
  if (omittedCount > 0) {
    const tag = document.createElement('div');
    tag.className = 'sources-tag';
    tag.title = 'Older messages were left out of this request to stay within the available context length — they\'re still saved in this chat, just not sent to the model this turn.';
    tag.textContent = `⋯ ${omittedCount} earlier message${omittedCount === 1 ? '' : 's'} omitted to fit context`;
    assistantBody.parentElement.insertBefore(tag, assistantBody);
  }

  // sendMessage rejects if generation is stopped (or the connection drops
  // mid-stream) — either way, whatever was already streamed into `full` up
  // to that point is real and worth keeping, not discarding.
  try {
    await window.localAI.sendMessage({ streamId, model: state.model, chatId: state.chatId, messages, options });
  } catch (err) {
    if (assistantBody.classList.contains('pending')) {
      // Stopped/failed before a single token arrived — nothing to show.
      clearInterval(pendingInterval);
      assistantBody.classList.remove('pending');
      assistantBody.innerHTML = '';
    }
    const tag = document.createElement('div');
    tag.className = 'sources-tag';
    tag.textContent = state.aborting ? '⏹ Stopped' : `⚠ Generation didn't finish: ${ipcErrorText(err)}`;
    assistantBody.parentElement.appendChild(tag);
    // A user Stop with nothing streamed leaves nothing worth showing; a real
    // failure keeps the (empty) bubble so its warning stays on screen —
    // removing it here used to make errors like an unloaded/unknown model
    // vanish without a trace.
    if (!full && state.aborting) assistantBody.parentElement.remove();
  }
  clearInterval(pendingInterval); // safety net — a zero-token success resolves without ever hitting the two clears above

  // sendMessage can resolve successfully having streamed zero visible
  // tokens — Ollama isn't wrong that the request "succeeded", it just spent
  // its whole budget on a hidden `thinking` field (or similar) and hit the
  // context/length limit before writing anything to `content`. Neither
  // branch above catches this: the token handler never saw a truthy token,
  // and no error was thrown. Left alone, the bubble sits on "pending"
  // forever with no explanation — this is the only place left to catch it.
  if (assistantBody.classList.contains('pending')) {
    assistantBody.classList.remove('pending');
    assistantBody.innerHTML = '';
    const tag = document.createElement('div');
    tag.className = 'sources-tag';
    tag.textContent = '⚠ The model produced no reply — it likely ran out of context while reasoning about this request. Try a shorter message or a smaller/simpler image.';
    assistantBody.parentElement.appendChild(tag);
  }

  currentPendingPhase = null;
  if (full) await window.localAI.saveAssistantMessage(state.chatId, full);

  unsubscribe();
  state.streaming = false;
  state.aborting = false;
  setSendButtonMode('send');
  refreshChatList();
  refreshModelLoadState();

  // Auto-title a fresh chat from its first exchange — fire-and-forget, and
  // only for chats still on the default title (a manual rename in the
  // meantime, however unlikely mid-stream, should win).
  if (isFirstExchange && full) {
    const chatIdAtStart = state.chatId;
    window.localAI.generateChatTitle(state.model, chatIdAtStart, text).then(({ title }) => {
      if (title) refreshChatList();
    });
  }
});

// The composer's Send button doubles as Stop while a reply is streaming —
// same element, so Enter-to-submit and disabled-state styling keep working
// for free; only its label/behavior switches.
function setSendButtonMode(mode) {
  els.send.disabled = false;
  els.send.classList.toggle('stop-mode', mode === 'stop');
  els.send.textContent = mode === 'stop' ? 'Stop' : 'Send';
}
els.send.addEventListener('click', (e) => {
  if (!state.streaming) return;
  e.preventDefault(); // don't let this click also trigger the form's submit
  state.aborting = true;
  window.localAI.abortGeneration();
});

els.ragToggle.addEventListener('click', () => {
  state.ragEnabled = !state.ragEnabled;
  els.ragToggle.classList.toggle('active', state.ragEnabled);
  els.ragToggle.title = state.ragEnabled ? 'Library context: ON — click to disable' : 'Use library context (RAG)';
  refreshModelLoadState(); // changes the context size the model needs (see chatNumCtx)
});

// ---- ZIM archive search in chat (main.js zim:* / services/zimSearch.js) ----
// The 🗃️ button opens a checklist of every searchable .zim plus the
// Quick/Thorough choice. Nothing is ticked when the app starts or in a new
// chat; a chat that used archives gets its own choice back when reopened
// (saved in chats.zim_settings). Whenever archives are ticked, the choice
// stays on screen — as the full list while open, or a one-line summary.
let zimBookList = null; // [{ id, title, ftindex, articles }] once loaded
let zimPickerOpen = false;
let zimTitles = {}; // id -> title, so the summary can name archives without starting the search server

function updateZimToggle() {
  const on = state.zimBooks.length > 0;
  els.zimToggle.classList.toggle('active', on);
  els.zimToggle.title = zimPickerOpen ? 'Close the archive list' : 'Search ZIM archives (Wikipedia, MedlinePlus…) when answering';
  els.zimPicker.classList.toggle('hidden', !zimPickerOpen);
  els.zimSummary.classList.toggle('hidden', zimPickerOpen || !on);
  if (on) {
    const names = state.zimBooks.map((id) => zimTitles[id] || readableZimId(id));
    els.zimSummaryText.textContent = `🗃️ Searching (${state.zimMode === 'thorough' ? 'Thorough' : 'Quick'}): ${names.join(', ')}`;
  }
  refreshModelLoadState(); // ticking archives changes the context size the model needs
}

// "wikipedia_en_all_maxi_2026-08" -> "Wikipedia" — for chats saved before
// archive titles were stored with them, until the real list is loaded.
function readableZimId(id) {
  const s = id.replace(/_\d{4}-\d{2}[a-z]?$/, '').replace(/_(en|all|maxi|nopic|mini)(?=_|$)/g, '').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Rescanned every time the picker opens, so new files, deleted files and
// changed folder settings always show — cheap once kiwix-serve is running,
// which only restarts when the set of files actually changed.
async function loadZimBooks() {
  if (!zimBookList) els.zimPickerList.textContent = 'Starting the archive search…';
  const { books } = await window.localAI.zimListSearchable();
  zimBookList = books;
  for (const b of books) zimTitles[b.id] = b.title;
  // Ticks for archives that no longer exist (deleted, drive not plugged in) are dropped.
  state.zimBooks = state.zimBooks.filter((id) => books.some((b) => b.id === id));
  return books;
}

function renderZimPicker() {
  els.zimPickerList.innerHTML = '';
  if (!zimBookList.length) {
    els.zimPickerList.textContent = 'No .zim files found — check the ZIM archive folders in Tools → Library.';
    return;
  }
  for (const b of zimBookList) {
    const label = document.createElement('label');
    label.title = b.ftindex ? b.id : `${b.id} — no full-text index, so only article titles are searched`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.zimBooks.includes(b.id);
    box.onchange = () => {
      state.zimBooks = box.checked ? [...state.zimBooks, b.id] : state.zimBooks.filter((id) => id !== b.id);
      updateZimToggle();
    };
    const name = document.createElement('span');
    name.className = 'zim-name';
    name.textContent = b.title;
    const meta = document.createElement('span');
    meta.className = 'zim-meta';
    const count = b.articles >= 1e6 ? `${(b.articles / 1e6).toFixed(1)}M` : b.articles >= 1e3 ? `${Math.round(b.articles / 1e3)}K` : String(b.articles);
    const twin = zimBookList.filter((x) => x.title === b.title).length > 1;
    meta.textContent = [count, b.date, b.ftindex ? null : 'titles only', twin && b.folder ? b.folder : null].filter(Boolean).join(' · ');
    if (b.folder) label.title += `\n${b.folder}`;
    label.append(box, name, meta);
    els.zimPickerList.appendChild(label);
  }
  els.zimPicker.querySelector(`input[name="zim-mode"][value="${state.zimMode}"]`).checked = true;
  els.zimPickerNote.textContent = 'Pick only the archives that fit the topic — fewer gives faster, more on-topic answers.';
}

function saveZimSettings() {
  const titles = Object.fromEntries(state.zimBooks.map((id) => [id, zimTitles[id] || id]));
  window.localAI.zimSaveSettings({ chatId: state.chatId, books: state.zimBooks, mode: state.zimMode, titles });
}

async function openZimPicker() {
  zimPickerOpen = true;
  updateZimToggle();
  await loadZimBooks();
  renderZimPicker();
  updateZimToggle();
}

function closeZimPicker() {
  zimPickerOpen = false;
  updateZimToggle();
  saveZimSettings();
}

els.zimToggle.addEventListener('click', () => (zimPickerOpen ? closeZimPicker() : openZimPicker()));
els.zimPicker.querySelectorAll('input[name="zim-mode"]').forEach((r) => {
  r.addEventListener('change', () => { if (r.checked) { state.zimMode = r.value; updateZimToggle(); } });
});
els.zimPickerNone.onclick = () => {
  state.zimBooks = [];
  renderZimPicker();
  updateZimToggle();
};
els.zimPickerDone.onclick = closeZimPicker;
els.zimSummaryChange.onclick = openZimPicker;
els.zimSummaryClear.onclick = () => {
  state.zimBooks = [];
  updateZimToggle();
  saveZimSettings();
};

// ---- ZIM archive folders (Tools → Library) ----
// Which folders the 🗃️ list is built from: automatic ones (switchable) plus
// folders the user adds. Any change empties the cached archive list so the
// next 🗃️ open rescans (and kiwix-serve restarts with the new set).
function renderZimFolders(folders) {
  els.zimFolderList.innerHTML = '';
  for (const fo of folders) {
    const row = document.createElement('div');
    row.className = 'zim-folder-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = fo.enabled;
    box.disabled = !fo.auto; // added folders are switched off by removing them
    box.title = fo.auto ? 'Search this folder' : 'Added folders are always searched — use Remove to stop';
    box.onchange = async () => {
      renderZimFolders(await window.localAI.zimSetFolderEnabled({ key: fo.key, enabled: box.checked }));
      zimBookList = null;
    };
    const text = document.createElement('div');
    text.className = 'zim-folder-text';
    const name = document.createElement('div');
    name.textContent = fo.label || fo.path;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = !fo.path ? 'Not connected — set the Research folder above'
      : !fo.exists ? `${fo.path} — not found (drive not plugged in?)`
      : `${fo.label ? `${fo.path} · ` : ''}${fo.count} archive${fo.count === 1 ? '' : 's'}`;
    text.append(name, meta);
    row.append(box, text);
    if (!fo.auto) {
      const rm = document.createElement('button');
      rm.className = 'pull-btn';
      rm.textContent = 'Remove';
      rm.onclick = async () => {
        renderZimFolders(await window.localAI.zimRemoveFolder(fo.path));
        zimBookList = null;
      };
      row.append(rm);
    }
    els.zimFolderList.appendChild(row);
  }
}

async function refreshZimFolders() {
  renderZimFolders(await window.localAI.zimGetFolders());
}

els.zimFolderAdd.onclick = async () => {
  const res = await window.localAI.zimAddFolder();
  renderZimFolders(res.folders);
  if (res.ok) zimBookList = null;
  else if (res.error) await showAppAlert(res.error);
};

// Back to nothing ticked (new chat), or the chat's own saved choice.
// Read from the chat list (SELECT * includes zim_settings).
async function applyChatZimSettings(chatId) {
  const chats = await window.localAI.listChats();
  let saved = null;
  try { saved = JSON.parse(chats.find((c) => c.id === chatId)?.zim_settings || 'null'); } catch { /* ignore */ }
  state.zimBooks = [...(saved?.books || [])];
  state.zimMode = saved?.mode === 'thorough' ? 'thorough' : 'quick';
  Object.assign(zimTitles, saved?.titles || {});
  if (zimPickerOpen && zimBookList) renderZimPicker();
  updateZimToggle();
}

els.modelSelect.addEventListener('change', () => {
  state.model = els.modelSelect.value;
  window.localAI.setCurrentModel(state.model);
  refreshModelLoadState();
});

window.localAI.onOllamaStatus(({ ready, backend }) => setStatus(ready, backend));
async function setStatus(ready, backend) {
  if (backend) state.backend = backend;
  const lm = state.backend === 'lmstudio';
  if (lm) state.lmstudioAutoLoad = (await window.localAI.getBackendSettings()).lmstudioAutoLoad;
  els.statusDot.classList.toggle('ready', ready);
  els.statusText.textContent = lm
    ? (ready ? 'LM Studio connected' : "LM Studio not reachable — start its local server")
    : (ready ? 'Model runtime ready' : 'Model runtime unavailable');
  // Refresh the model list either way, so a switch to an unreachable
  // runtime doesn't leave the previous runtime's models selectable.
  refreshModels();
  if (ready) { refreshCatalog(); refreshModelLoadState(); }
}

// Electron wraps errors thrown in a main-process handler as "Error invoking
// remote method 'x': Error: <message>" — only <message> is meant for the user.
function ipcErrorText(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ============================================================ model load state
// Whether the *currently selected* model is actually resident in Ollama's
// memory right now — distinct from the runtime being reachable at all.
// Ollama loads a model into RAM/VRAM lazily on first use and can take
// several seconds to tens of seconds for larger models, so this is the one
// part of "is it ready" the status dot alone doesn't cover.
// Live "Loading model… Ns" / "Model loaded" text next to the dot, the same
// pattern as the "Processing image… Ns" reply placeholder above. Guarded by
// modelLoadUiMode so the 5s refreshModelLoadState() poll below doesn't
// restart the timer or re-flash "Model loaded" every time it re-confirms a
// mode that hasn't actually changed.
let modelLoadUiMode = 'idle';
let modelLoadUiLabel = 'Loading model';
let modelLoadTimerInterval = null;
let modelLoadTextClearTimeout = null;

function setModelLoadState(mode, label = 'Loading model') {
  els.modelLoadDot.classList.toggle('loaded', mode === 'loaded');
  els.modelLoadDot.classList.toggle('loading', mode === 'loading');
  els.modelLoadDot.title =
    mode === 'loading' ? 'Loading model into memory…'
    : mode === 'loaded' ? 'Model loaded in memory'
    : 'Not loaded in memory yet — first message will take longer';

  els.modelLoadBtn.classList.toggle('hidden', mode !== 'idle' || !state.model);
  if (mode === modelLoadUiMode && (mode !== 'loading' || label === modelLoadUiLabel)) return;
  modelLoadUiMode = mode;
  modelLoadUiLabel = label;
  clearInterval(modelLoadTimerInterval);
  modelLoadTimerInterval = null;
  clearTimeout(modelLoadTextClearTimeout);
  modelLoadTextClearTimeout = null;

  if (mode === 'loading') {
    const start = Date.now();
    els.modelLoadText.textContent = `${label}… 0s`;
    els.modelLoadText.classList.remove('hidden');
    modelLoadTimerInterval = setInterval(() => {
      els.modelLoadText.textContent = `${label}… ${Math.floor((Date.now() - start) / 1000)}s`;
    }, 1000);
  } else if (mode === 'loaded') {
    els.modelLoadText.textContent = 'Model loaded';
    els.modelLoadText.classList.remove('hidden');
    modelLoadTextClearTimeout = setTimeout(() => els.modelLoadText.classList.add('hidden'), 3000);
  } else {
    els.modelLoadText.classList.add('hidden');
  }
}

// Ollama reloads a model whenever a request's num_ctx differs from the one
// it was loaded with — even a smaller one. If the selected model is already
// resident with at least `needed`, ask for exactly that size instead.
async function fitResidentCtx(needed) {
  if (state.backend !== 'ollama') return needed;
  try {
    const m = (await window.localAI.getRunningModels()).find((r) => r.name === state.model);
    if (m?.context_length && m.context_length >= (needed || 0)) return m.context_length;
  } catch { /* fall through */ }
  return needed;
}

// 'loaded' = resident and ready for the next request; 'resize' = resident
// but Ollama would reload it because the request needs a different context
// size (e.g. it was loaded before ZIM archives were ticked); 'idle' = not
// resident. LM Studio never reloads for this, so it's never 'resize' there.
async function modelResidency() {
  try {
    const running = await window.localAI.getRunningModels();
    const m = running.find((r) => r.name === state.model);
    if (!m) return 'idle';
    let want = chatNumCtx();
    // Requests are sized to the model's tested context (see tunedOptions in ollama.js)
    const tuned = state.backend === 'ollama' ? (await window.localAI.getOllamaTuning(state.model))?.context : null;
    if (tuned) want = state.contextSize === null ? tuned : Math.min(want || tuned, tuned);
    if (state.backend === 'ollama' && want && m.context_length && m.context_length < want) return 'resize';
    return 'loaded';
  } catch {
    return 'idle';
  }
}

async function refreshModelLoadState() {
  if (!state.model || state.streaming || modelLoadingByButton) return; // don't fight a 'loading' state already in progress
  const r = await modelResidency();
  els.modelLoadBtn.textContent = r === 'resize' ? 'Reload model' : 'Load model';
  els.modelLoadBtn.title = r === 'resize'
    ? 'The model is loaded with a smaller context than ZIM/library search needs — the next question would reload it anyway. Reload it now.'
    : 'Load the selected model into memory now, so your first question is answered faster';
  setModelLoadState(r === 'loaded' ? 'loaded' : 'idle');
}
setInterval(refreshModelLoadState, 5000);

// The reply bubble currently waiting for its first token, if any — lets the
// reload notice below show up there as well as in the header.
let currentPendingPhase = null;

// Ollama is reloading the model because a request needs a bigger context
// than it's loaded with (ZIM/library/image after plain chat on a smaller
// size, or a bigger size picked in Tools → Models). Smaller or unspecified
// sizes never reload — see fitOptions in ollama.js.
const ctxLabel = (n) => (n >= 1024 ? `${Math.round(n / 1024)}K` : String(n));
window.localAI.onModelReload(({ from, to }) => {
  const text = `Reloading model for a larger context (${ctxLabel(from)} → ${ctxLabel(to)})`;
  setModelLoadState('loading', text);
  currentPendingPhase?.(text);
});

// The context size a chat request will use — with library or ZIM lookups
// on it's always the 16K bump (see needsContextBump in the send handler),
// so loading ahead with the same size means no reload on the first question.
function chatNumCtx() {
  const bump = state.ragEnabled || state.zimBooks.length > 0;
  return bump ? Math.max(state.contextSize || 0, 16384) : state.contextSize;
}

// "Load model": loads the selected model before the first question (and
// starts the ZIM search server if archives are ticked). Optional — sending
// a message still loads it the same as always.
let modelLoadingByButton = false;
els.modelLoadBtn.onclick = async () => {
  if (!state.model || modelLoadingByButton) return;
  modelLoadingByButton = true;
  setModelLoadState('loading');
  // Always room for ZIM/library lookups (16K), so ticking them after loading
  // doesn't force a reload; plain chats then reuse it too (fitResidentCtx).
  const numCtx = Math.max(state.contextSize || 0, 16384);
  const res = await window.localAI.loadChatModel({ model: state.model, options: numCtx ? { num_ctx: numCtx } : undefined, zim: state.zimBooks.length > 0 });
  modelLoadingByButton = false;
  if (!res.success) {
    setModelLoadState('idle');
    await showAppAlert(`Couldn't load the model: ${res.error}`);
    return;
  }
  refreshModelLoadState();
};

// ============================================================ tools panel
function showTab(name) {
  els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  els.panels.forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'models') { refreshBackendControl(); refreshModelsLocation(); refreshCatalogTiers(); refreshContextSizeControl(); }
  if (name === 'library') { refreshZimFolders(); refreshUploads(); populateCategorySelect(els.libraryUploadCategory, { allowNew: true }); refreshResearchStatus(); }
  if (name === 'mobile') { refreshMobileStatus(); }
  if (name === 'system') { refreshSystemInfo(); }
}
els.tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

els.openTools.onclick = () => { els.toolsOverlay.classList.remove('hidden'); refreshBackendControl(); refreshCatalogTiers(); refreshContextSizeControl(); refreshCatalog(); refreshModelsLocation(); };
els.closeTools.onclick = () => { els.toolsOverlay.classList.add('hidden'); };
els.toolsOverlay.addEventListener('click', (e) => { if (e.target === els.toolsOverlay) { els.toolsOverlay.classList.add('hidden'); } });

// ============================================================ main-window view switch
// Swaps .main's content between the chat layout and the full-size Reference
// Library browser/viewer — see the CSS comment on .main-view for why this
// lives here instead of inside the Tools side-panel.
function showMainView(name) {
  els.chatView.classList.toggle('active', name === 'chat');
  els.libraryView.classList.toggle('active', name === 'library');
  els.analyzeView.classList.toggle('active', name === 'analyze');
  els.translateView.classList.toggle('active', name === 'translate');
  // Returned so a caller that opens one document can wait for the list to
  // finish loading first - otherwise the list would cover the document.
  const libraryReady = name === 'library' ? initLibraryBrowser() : null;
  return libraryReady;
}
function isMainViewActive(name) {
  return { library: els.libraryView, analyze: els.analyzeView, translate: els.translateView }[name].classList.contains('active');
}
// Clicking a view's own sidebar button again returns to chat, rather than
// requiring the small "←" back button inside that view — same "click to
// open, click again to leave" expectation as any toggle button.
els.openLibraryView.onclick = () => showMainView(isMainViewActive('library') ? 'chat' : 'library');
els.libraryBackToChat.onclick = () => showMainView('chat');
els.openAnalyzeView.onclick = () => showMainView(isMainViewActive('analyze') ? 'chat' : 'analyze');
els.analyzeBackToChat.onclick = () => showMainView('chat');
els.openTranslateView.onclick = () => {
  if (isMainViewActive('translate')) { showMainView('chat'); return; }
  refreshTranslateTextModelSelect();
  showMainView('translate');
};
els.translateBackToChat.onclick = () => showMainView('chat');

// ---- models / catalog ----------------------------------------------------
// The catalog comes from data/<tier>-models-catalog.json — one plain JSON
// file per GPU VRAM tier (4K/8K/12K/24K/32K), each meant to be hand-edited —
// see services/modelCatalog.js. The user picks one or several tiers in the
// GPU size row below; refreshCatalog() re-reads and merges whichever tiers
// are currently selected fresh on every refresh, so editing a tier's file
// and reopening/reloading this tab is the whole "swap models out" workflow,
// no code changes or rebuild involved.
async function refreshCatalogTiers() {
  const [tiers, selected] = await Promise.all([
    window.localAI.getCatalogTiers(),
    window.localAI.getSelectedCatalogTiers(),
  ]);
  const selectedSet = new Set(selected);
  els.catalogTiersList.innerHTML = '';
  for (const t of tiers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tier-btn' + (selectedSet.has(t.tier) ? ' active' : '');
    btn.disabled = !t.available;
    btn.innerHTML = `${t.tier}<span class="tier-count">${t.available ? `${t.modelCount} model${t.modelCount === 1 ? '' : 's'}` : 'missing'}</span>`;
    btn.title = t.available ? `${t.tier} VRAM tier` : `${t.path} not found`;
    btn.onclick = async () => {
      const next = selectedSet.has(t.tier) ? [...selectedSet].filter((x) => x !== t.tier) : [...selectedSet, t.tier];
      if (next.length === 0) return; // keep at least one tier selected
      const applied = await window.localAI.setSelectedCatalogTiers(next);
      selectedSet.clear();
      applied.forEach((x) => selectedSet.add(x));
      btn.classList.toggle('active', selectedSet.has(t.tier));
      refreshCatalog();
      refreshModels();
    };
    els.catalogTiersList.appendChild(btn);
  }
}

// "Auto" (null) plus every preset from CONTEXT_SIZE_PRESETS in main.js —
// fetched rather than hardcoded here so the two lists can't drift apart.
// Selecting a preset sets the floor num_ctx for every chat request from now
// on (see computeContextOptions()); selecting Auto goes back to leaving it
// to Ollama's own vram-based sizing.
async function refreshContextSizeControl() {
  const [presets, selected] = await Promise.all([
    window.localAI.getContextSizePresets(),
    window.localAI.getContextSize(),
  ]);
  state.contextSize = selected;
  els.contextSizeList.innerHTML = '';
  const options = [{ value: null, label: 'Auto' }, ...presets.map((p) => ({ value: p, label: `${p / 1024}K` }))];
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tier-btn' + (selected === opt.value ? ' active' : '');
    btn.textContent = opt.label;
    btn.title = opt.value === null
      ? "Use each model's tested best context for this GPU size (Ollama decides for untested models)"
      : `Use at least ${opt.value.toLocaleString()} tokens of context for every message (Ollama models: capped at the tested size that fits the GPU)`;
    btn.onclick = async () => {
      const res = await window.localAI.setContextSize(opt.value);
      state.contextSize = res.size;
      [...els.contextSizeList.children].forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      els.contextSizeNote.textContent = res.unloaded
        ? `${res.unloaded} was unloaded so the new size takes effect — it loads again with your next message (or click Load model).`
        : await tuningNote();
      refreshModelLoadState();
    };
    els.contextSizeList.appendChild(btn);
  }
  els.contextSizeNote.textContent = await tuningNote();
}

// One line under the context buttons saying what the selected Ollama model
// will actually use, so the measured settings aren't invisible.
async function tuningNote() {
  if (state.backend !== 'ollama' || !state.model) return '';
  const t = await window.localAI.getOllamaTuning(state.model);
  if (!t?.context) return `${state.model}: no tested settings for this GPU size — Ollama decides.`;
  const ctx = state.contextSize === null ? t.context : Math.min(state.contextSize, t.context);
  const cache = t.kvCache === 'q8_0' ? '8-bit' : '16-bit';
  return `${state.model}: ${ctxLabel(ctx)} context, ${cache} cache (tested best fit: ${ctxLabel(t.context)}).`;
}

// Chat runtime picker (Ollama / LM Studio) plus LM Studio's options and live
// status. Switching saves the choice per-machine and triggers an
// ollama-status event, which refreshes the model list and status dot.
async function refreshBackendControl() {
  const settings = await window.localAI.getBackendSettings();
  state.backend = settings.backend;
  state.lmstudioAutoLoad = settings.lmstudioAutoLoad;
  els.backendList.innerHTML = '';
  for (const opt of [{ value: 'ollama', label: 'Ollama' }, { value: 'lmstudio', label: 'LM Studio' }]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tier-btn' + (settings.backend === opt.value ? ' active' : '');
    btn.textContent = opt.label;
    btn.onclick = async () => {
      if (state.streaming) { await showAppAlert('Wait for the current reply to finish (or stop it) before switching runtimes.'); return; }
      await window.localAI.setBackendSettings({ backend: opt.value });
      refreshBackendControl();
    };
    els.backendList.appendChild(btn);
  }

  const lm = settings.lmstudio;
  els.backendLmstudioOptions.hidden = settings.backend !== 'lmstudio';
  els.backendLmstudioAutoload.checked = settings.lmstudioAutoLoad;
  els.backendLmstudioThinking.checked = settings.lmstudioThinking;
  els.backendVisionOllama.checked = settings.visionUseOllama;
  const jitText = lm.jitEnabled === true ? 'On — LM Studio swaps models itself'
    : lm.jitEnabled === false ? 'Off — the app loads models through LM Studio\'s API'
    : 'Unknown';
  els.backendLmstudioStatus.innerHTML = '';
  const rows = [
    ['LM Studio server', lm.reachable ? `Running on port ${lm.port}` : `Not reachable on port ${lm.port} — start it in LM Studio's Developer tab`],
    ['Models available', lm.reachable ? String(lm.modelCount) : '—'],
    ['Loaded now', lm.reachable ? (lm.loaded.join(', ') || 'None — load one in LM Studio, or rely on auto-load') : '—'],
    ['Just-in-Time loading', jitText],
    ['Context length', 'Set in LM Studio when the model loads (the setting below applies to Ollama)'],
  ];
  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const a = document.createElement('span');
    a.textContent = k;
    const b = document.createElement('span');
    b.textContent = v;
    row.append(a, b);
    els.backendLmstudioStatus.appendChild(row);
  }
}
els.backendLmstudioAutoload.addEventListener('change', async () => {
  const s = await window.localAI.setBackendSettings({ lmstudioAutoLoad: els.backendLmstudioAutoload.checked });
  state.lmstudioAutoLoad = s.lmstudioAutoLoad;
});
els.backendLmstudioThinking.addEventListener('change', () => {
  window.localAI.setBackendSettings({ lmstudioThinking: els.backendLmstudioThinking.checked });
});
els.backendVisionOllama.addEventListener('change', () => {
  window.localAI.setBackendSettings({ visionUseOllama: els.backendVisionOllama.checked });
});

async function refreshCatalog() {
  const [catalog, catalogInfo, installed, downloadStatus] = await Promise.all([
    window.localAI.getCatalog(),
    window.localAI.getCatalogFileInfo(),
    window.localAI.listModels(),
    window.localAI.getDownloadStatus(),
  ]);

  els.catalogFileInfoList.innerHTML = '';
  for (const info of catalogInfo) {
    const row = document.createElement('div');
    row.className = 'catalog-file-info-row';
    row.innerHTML = `
      <code class="meta">${info.tier}: ${info.path}</code>
      <button class="btn-icon reveal-btn" title="Show this file in its folder">📂</button>
    `;
    row.querySelector('.reveal-btn').onclick = () => window.localAI.revealCatalogFile(info.tier);
    els.catalogFileInfoList.appendChild(row);
    if (info.error) {
      const warn = document.createElement('p');
      warn.className = 'panel-hint';
      warn.style.color = 'var(--danger)';
      warn.textContent = `Couldn't parse ${info.tier} (${info.error}) — its models are left out until it's fixed.`;
      els.catalogFileInfoList.appendChild(warn);
    }
  }

  const installedNames = new Set(installed.map((m) => m.name));
  const catModels = catalog.models || {};
  const catWeights = catalog.categories || {};

  // Group by category, then sort the groups by weight (lower first; a
  // category with no assigned weight sorts last) with ties broken
  // alphabetically by category name — same rule the main chat dropdown uses,
  // so the two stay consistent with each other.
  const groups = new Map();
  for (const [key, info] of Object.entries(catModels)) {
    const category = info.category || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push([key, info]);
  }
  const sortedCategories = [...groups.keys()].sort((a, b) => {
    const weightA = a in catWeights ? catWeights[a] : Infinity;
    const weightB = b in catWeights ? catWeights[b] : Infinity;
    return weightA !== weightB ? weightA - weightB : a.localeCompare(b);
  });

  els.catalogList.innerHTML = '';
  for (const category of sortedCategories) {
    const heading = document.createElement('h4');
    heading.className = 'panel-subhead';
    heading.textContent = category;
    els.catalogList.appendChild(heading);

    // Smallest-first within a category, same as the main dropdown; ties (or
    // an unparseable size) fall back to alphabetical by model id.
    const entries = groups.get(category).sort(([keyA, infoA], [keyB, infoB]) => {
      const sizeDiff = parseSizeToMB(infoA.size) - parseSizeToMB(infoB.size);
      return sizeDiff !== 0 ? sizeDiff : keyA.localeCompare(keyB);
    });
    for (const [key, info] of entries) {
      const isInstalled = installedNames.has(key);
      const progress = downloadStatus[key];
      const item = document.createElement('div');
      item.className = 'catalog-item';
      item.innerHTML = `
        <div class="row">
          <div>
            <div class="name">${info.name}${info.tier ? `<span class="tier-badge">${info.tier}</span>` : ''}</div>
            <div class="meta">${key} · ${info.size}</div>
          </div>
          <div class="catalog-actions">
            <button class="pull-btn ${isInstalled ? 'installed' : ''}" data-key="${key}">
              ${isInstalled ? 'Installed' : progress ? `${progress.progress}%` : 'Pull'}
            </button>
            ${isInstalled ? '<button class="icon-delete-btn" title="Delete this model from disk">🗑</button>' : ''}
          </div>
        </div>
        <div class="desc">${info.description || ''}</div>
        ${progress ? '<div class="progress-bar"><div class="progress-fill" style="width:' + progress.progress + '%"></div></div>' : ''}
      `;
      if (!isInstalled) {
        item.querySelector('.pull-btn').onclick = async (e) => {
          e.target.disabled = true;
          await window.localAI.pullModel(key);
          refreshCatalog();
          refreshModels();
        };
      } else {
        item.querySelector('.icon-delete-btn').onclick = async (e) => {
          if (!(await showAppConfirm(`Delete "${info.name}" (${key})? This removes it from disk — you can pull it again later.`))) return;
          e.target.disabled = true;
          const result = await window.localAI.deleteModel(key);
          if (!result.success) {
            await showAppAlert(`Couldn't delete "${info.name}": ${result.error}`);
            e.target.disabled = false;
            return;
          }
          refreshCatalog();
          refreshModels();
        };
      }
      els.catalogList.appendChild(item);
    }
  }
}

window.localAI.onPullProgress(() => refreshCatalog());
window.localAI.onPullComplete(() => { refreshCatalog(); refreshModels(); });

// ---- library --------------------------------------------------------------

// One cited document under a reply (or in a search result): a Local/Research
// badge plus the title, clickable to open it in the Reference Library.
function sourceLink({ id, title, kind, bookTitle, file, url }) {
  const a = document.createElement('span');
  a.className = 'src-link';
  if (kind === 'zim') {
    // A ZIM article: opens in its own small window (JustAI has no Wikipedia viewer).
    a.title = `From the ${bookTitle} archive — click to read it`;
    const badge = document.createElement('span');
    badge.className = 'src-badge zim';
    badge.textContent = bookTitle || 'ZIM';
    a.append(badge, title);
    a.onclick = async () => {
      const res = await window.localAI.zimOpenArticle({ url, title });
      if (!res?.success) await showAppAlert(`Couldn't open "${title}" — its .zim file may have moved.`);
    };
    return a;
  }
  a.title = kind === 'research' ? 'Linked from your Research library — click to read it' : 'One of your own uploads — click to read it';
  const badge = document.createElement('span');
  badge.className = `src-badge ${kind === 'research' ? 'research' : 'local'}`;
  badge.textContent = kind === 'research' ? 'Research' : 'Local';
  a.append(badge, title);
  a.onclick = async () => {
    await showMainView('library');
    await openBrowserDoc(id);
  };
  return a;
}

// "home-repair" -> "Home-Repair" — used anywhere a raw category value (the DB/
// filter form, all-lowercase-hyphenated) is shown to the user. The raw form
// stays what's stored/filtered on; this is purely a display transform.
function formatCategoryLabel(raw) {
  return raw.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

const NEW_CATEGORY_VALUE = '__new__';

// Shared by the upload category picker and the Reference Library filter —
// both want "existing categories, formatted, with a doc count" as their
// option list; only the upload picker also gets a "+ Add new" choice.
async function populateCategorySelect(selectEl, { allowNew = false } = {}) {
  const { categories } = await window.localAI.libraryBrowseFacets();
  selectEl.querySelectorAll('option[data-category]').forEach((o) => o.remove());
  for (const { category, count } of categories) {
    const opt = new Option(`${formatCategoryLabel(category)} (${count})`, category);
    opt.dataset.category = '1';
    selectEl.appendChild(opt);
  }
  if (allowNew && !selectEl.querySelector(`option[value="${NEW_CATEGORY_VALUE}"]`)) {
    selectEl.appendChild(new Option('+ Add new category…', NEW_CATEGORY_VALUE));
  }
  return categories;
}

els.libraryUploadCategory.addEventListener('change', () => {
  const isNew = els.libraryUploadCategory.value === NEW_CATEGORY_VALUE;
  els.libraryNewCategoryInput.hidden = !isNew;
  if (isNew) els.libraryNewCategoryInput.focus();
});

els.libraryFile.addEventListener('change', async () => {
  const file = els.libraryFile.files[0];
  if (!file) return;
  const category = els.libraryUploadCategory.value === NEW_CATEGORY_VALUE
    ? els.libraryNewCategoryInput.value.trim()
    : els.libraryUploadCategory.value;
  if (!category) {
    await showAppAlert('Choose a category (or add a new one) before uploading.');
    els.libraryFile.value = '';
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const result = await window.localAI.libraryUpload({ name: file.name, base64, category });
    if (result.duplicate) {
      const { existing } = result;
      const label = existing.category ? `${existing.title} (${formatCategoryLabel(existing.category)})` : existing.title;
      const canView = !!existing.external_id; // bulk-imported docs are viewable in the Library view; another of your own uploads isn't
      if (canView) {
        if (await showAppConfirm(`"${file.name}" already appears to be in the library, as "${label}". Not added. View the existing copy?`)) {
          await showMainView('library');
          await openBrowserDoc(existing.id);
        }
      } else {
        await showAppAlert(`"${file.name}" already appears to be in the library, as "${label}" (one of your own earlier uploads). Not added.`);
      }
    } else if (!result.ok) {
      await showAppAlert(result.error);
    } else if (result.warning) {
      await showAppAlert(result.warning); // upload still succeeded, just a heads-up (e.g. scanned PDF with no text layer)
    }
  } catch (err) {
    await showAppAlert(`Couldn't upload "${file.name}": ${err.message}`);
  }
  els.libraryFile.value = '';
  els.libraryNewCategoryInput.value = '';
  els.libraryNewCategoryInput.hidden = true;
  populateCategorySelect(els.libraryUploadCategory, { allowNew: true }); // pick up a just-added new category / updated counts
  refreshUploads();
});

async function refreshUploads() {
  const docs = await window.localAI.libraryListUploads();
  els.libraryUploads.innerHTML = '';
  for (const d of docs) {
    const item = document.createElement('div');
    item.className = 'library-item';
    item.innerHTML = `<div class="row"><span>${d.title} <span class="meta">(${d.chunkCount ?? 0} chunk${d.chunkCount === 1 ? '' : 's'})</span></span><button class="pull-btn" data-id="${d.id}">Remove</button></div>`;
    item.querySelector('button').onclick = async () => { await window.localAI.libraryDeleteUpload(d.id); refreshUploads(); };
    els.libraryUploads.appendChild(item);
  }
}

async function runLibrarySearch() {
  const query = els.libraryQuery.value.trim();
  if (!query) return;
  const results = await window.localAI.librarySearch(query, LIBRARY_EMBED_MODEL);
  els.libraryResults.innerHTML = '';
  if (results.length === 0) {
    els.libraryResults.innerHTML = '<p class="panel-hint">No matches.</p>';
    return;
  }
  for (const r of results) {
    const item = document.createElement('div');
    item.className = 'library-item';
    item.innerHTML = `<div class="row"><strong></strong> <span class="meta">part ${r.chunkIndex + 1}</span></div><div class="desc">${r.preview || ''}</div>`;
    item.querySelector('strong').appendChild(sourceLink({ id: r.docId, title: r.title, kind: r.source === 'research' ? 'research' : 'local' }));
    els.libraryResults.appendChild(item);
  }
}
els.librarySearchBtn.onclick = runLibrarySearch;
els.libraryQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') runLibrarySearch(); });

// ---- reference library browser ---------------------------------------------
// Separate from the "Library" tab's upload/search UI above: this is a
// read/browse view over every document in the library. State is
// kept minimal — current filters + pagination cursor — and reset each time
// the tab is opened fresh via initLibraryBrowser().
const browserState = { cursor: null, category: '', source: '', search: '', facetsLoaded: false };

async function initLibraryBrowser() {
  if (!browserState.facetsLoaded) {
    await populateCategorySelect(els.browserCategory); // replaces its own previous options
    const { sources } = await window.localAI.libraryBrowseFacets();
    els.browserSource.querySelectorAll('option[data-source]').forEach((o) => o.remove());
    for (const s of sources) {
      const opt = new Option(s === 'research' ? 'Research (linked)' : s, s);
      opt.dataset.source = '1';
      els.browserSource.appendChild(opt);
    }
    browserState.facetsLoaded = true;
  }
  showBrowserListView();
  browserState.cursor = null;
  await runBrowserSearch({ reset: true });
}

async function runBrowserSearch({ reset = false } = {}) {
  if (reset) {
    browserState.cursor = null;
    browserState.search = els.browserQuery.value.trim();
    browserState.category = els.browserCategory.value;
    browserState.source = els.browserSource.value;
    els.browserResults.innerHTML = '';
  }
  const { items, nextCursor } = await window.localAI.libraryBrowse({
    search: browserState.search || null,
    category: browserState.category || null,
    source: browserState.source || null,
    cursor: browserState.cursor,
    limit: 50,
  });
  if (reset && items.length === 0) {
    els.browserResults.innerHTML = '<p class="panel-hint">No matches.</p>';
  }
  for (const doc of items) {
    const item = document.createElement('div');
    item.className = 'library-item browser-result';
    const meta = [doc.category ? formatCategoryLabel(doc.category) : null, doc.source === 'research' ? 'Research (linked)' : doc.source || 'Local upload', doc.word_count ? `${doc.word_count.toLocaleString()} words` : null, doc.imageCount ? `${doc.imageCount} image${doc.imageCount === 1 ? '' : 's'}` : null, doc.pdf_filename || /\.pdf$/i.test(doc.ext_original || '') ? '📄 PDF' : null]
      .filter(Boolean)
      .join(' · ');
    item.innerHTML = `<div class="row"><strong>${doc.title}</strong></div><div class="meta">${meta}</div>`;
    item.onclick = () => openBrowserDoc(doc.id);
    els.browserResults.appendChild(item);
  }
  browserState.cursor = nextCursor;
  els.browserLoadMore.hidden = !nextCursor;
}

function showBrowserListView() {
  els.browserListView.hidden = false;
  els.browserDocView.hidden = true;
  showBrowserTextView(); // don't leave a loaded PDF rendering in the background
}

// Toggles between the extracted-text view (images + rendered markdown) and
// the inline PDF viewer — only relevant for docs that have an original scan
// attached (see doc.pdf_filename).
function showBrowserTextView() {
  els.browserDocBody.hidden = false;
  els.browserDocImages.hidden = false;
  els.pdfViewerWrap.hidden = true;
  els.browserViewPdfBtn.hidden = false;
  els.browserViewTextBtn.hidden = true;
  window.libraryPdfViewer?.clear();
}

async function showBrowserPdfView(pdfUrl) {
  els.browserDocBody.hidden = true;
  els.browserDocImages.hidden = true;
  els.pdfViewerWrap.hidden = false;
  els.browserViewPdfBtn.hidden = true;
  els.browserViewTextBtn.hidden = false;
  try {
    await window.libraryPdfViewer.show(pdfUrl);
  } catch (err) {
    await showAppAlert(`Couldn't render the PDF inline: ${err.message}. Try "Open in system viewer" instead.`);
    showBrowserTextView();
  }
}

async function openBrowserDoc(id) {
  const doc = await window.localAI.libraryGetDoc(id);
  if (!doc) return;
  const isResearch = doc.source === 'research';
  const isUpload = doc.external_id === null;
  els.browserListView.hidden = true;
  els.browserDocView.hidden = false;
  els.browserDocTitle.textContent = doc.title;
  const where = isResearch ? `Research library: ${doc.ext_path}` : isUpload ? 'Local upload (stored in this app)' : null;
  const metaParts = [doc.category ? formatCategoryLabel(doc.category) : null, where, !isResearch && !isUpload ? doc.source : null, doc.license].filter(Boolean).join(' · ');
  els.browserDocMeta.innerHTML = '';
  els.browserDocMeta.append(metaParts);
  if (doc.source_url) {
    const link = document.createElement('a');
    link.href = doc.source_url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'source';
    els.browserDocMeta.append(' · ', link);
  }

  // Original file: an imported scan (libpdf://), a linked Research doc's
  // original read in place (research://), or the user's own uploaded file
  // (system viewer only).
  let pdfUrl = null;
  if (doc.pdf_filename) pdfUrl = `libpdf://${encodeURIComponent(doc.pdf_filename)}`;
  else if (isResearch && /\.pdf$/i.test(doc.ext_original || '')) pdfUrl = researchUrl(doc.ext_original);
  const hasOriginal = !!(doc.pdf_filename || (isResearch && doc.ext_original) || (isUpload && doc.filename));
  els.browserPdfControls.hidden = !hasOriginal;
  showBrowserTextView();
  els.browserViewPdfBtn.hidden = !pdfUrl;
  if (pdfUrl) {
    els.browserViewPdfBtn.onclick = () => showBrowserPdfView(pdfUrl);
    els.browserViewTextBtn.onclick = () => showBrowserTextView();
  }
  els.browserOpenPdfBtn.onclick = async () => {
    const res = await window.localAI.libraryOpenPdf(id);
    if (!res.ok) await showAppAlert(res.error || 'Could not open the file.');
  };

  els.browserDocImages.innerHTML = '';
  for (const img of doc.images || []) {
    const el = document.createElement('img');
    el.src = img.url;
    el.loading = 'lazy';
    els.browserDocImages.appendChild(el);
  }

  if (isResearch) {
    // Read the page live from the Research folder (images and all); fall
    // back to the indexed text if the folder isn't reachable right now.
    const live = await window.localAI.researchReadDoc(id);
    if (live.ok) {
      els.browserDocBody.innerHTML = window.marked ? window.marked.parse(live.body) : `<pre>${live.body}</pre>`;
      rewriteResearchLinks(els.browserDocBody, live.dir);
      return;
    }
    els.browserDocBody.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'panel-hint';
    note.textContent = `${live.error} Showing the indexed text instead.`;
    els.browserDocBody.appendChild(note);
    els.browserDocBody.insertAdjacentHTML('beforeend', window.marked ? window.marked.parse(doc.body || '') : `<pre>${doc.body || ''}</pre>`);
    return;
  }
  els.browserDocBody.innerHTML = window.marked ? window.marked.parse(doc.body || '') : `<pre>${doc.body || ''}</pre>`;
}

// research://root/<path> for a path relative to the Research folder.
function researchUrl(relPath) {
  return 'research://root/' + relPath.split('/').map(encodeURIComponent).join('/');
}

// A Research page's images and file links are relative to its own folder —
// point images at research:// (served read-only from the Research folder)
// and make file links (e.g. a PDF report) open in the system viewer.
function rewriteResearchLinks(container, dir) {
  const base = new URL(researchUrl(dir && dir !== '.' ? `${dir}/` : ''));
  const isRelative = (v) => v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('#');
  container.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (isRelative(src)) img.src = new URL(src, base).href;
    img.loading = 'lazy';
  });
  container.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (isRelative(href)) {
      const rel = decodeURIComponent(new URL(href, base).pathname).replace(/^\/+/, '');
      a.href = '#';
      a.title = 'Open from the Research library';
      a.onclick = async (e) => {
        e.preventDefault();
        const res = await window.localAI.researchOpenFile(rel);
        if (!res.ok) await showAppAlert(res.error);
      };
    } else if (/^https?:/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  });
}

// ---- Research library link (Tools/Settings → Library) ----------------------
function describeResearchStatus(st) {
  if (!st.connected) return 'Research library not connected — use "Change folder…" to point at it. Already-indexed text still answers questions.';
  const parts = [`Connected: ${st.root}`, `${st.docs.toLocaleString()} pages indexed`];
  if (st.docs) parts.push(`${st.embedded.toLocaleString()} with search vectors`);
  if (st.lastSync) parts.push(`last sync ${new Date(st.lastSync).toLocaleString()}`);
  if (st.catalogChanged) parts.push(st.docs ? 'new or changed items waiting — Sync to bring them in' : 'not synced yet');
  return parts.join(' · ');
}

async function refreshResearchStatus() {
  const st = await window.localAI.researchStatus();
  els.researchStatus.textContent = describeResearchStatus(st);
  setResearchRunning(st.running);
  if (st.progress && st.running) els.researchProgress.textContent = st.progress.message || '';
  return st;
}

function setResearchRunning(running) {
  els.researchSyncBtn.disabled = running;
  els.researchPauseBtn.hidden = !running;
  els.researchRemoveBtn.disabled = running;
  els.libraryResetBtn.disabled = running;
}

async function startResearchSync() {
  const { started } = await window.localAI.researchSync(LIBRARY_EMBED_MODEL);
  if (!started) {
    await showAppAlert('Couldn\'t start the sync — either one is already running or the Research folder isn\'t connected.');
    return;
  }
  els.researchNotice.classList.add('hidden');
  setResearchRunning(true);
}

els.researchSyncBtn.onclick = startResearchSync;
els.researchPauseBtn.onclick = () => window.localAI.researchPause();
els.researchChooseBtn.onclick = async () => {
  const res = await window.localAI.researchChooseRoot();
  if (!res.ok && !res.canceled) await showAppAlert(res.error);
  refreshResearchStatus();
  refreshZimFolders(); // its _sources\zim folder moves with it
  zimBookList = null;
};

window.localAI.onResearchSyncProgress((p) => {
  els.researchProgress.textContent = p.message || '';
  setResearchRunning(!!p.running);
  if (!p.running) {
    refreshResearchStatus();
    if (p.result) {
      const r = p.result;
      els.researchProgress.textContent = `${p.message} Added ${r.added}, updated ${r.updated}, removed ${r.removed}, unchanged ${r.unchanged}` +
        (r.missing ? `, ${r.missing} listed in the catalog but missing on disk` : '') +
        (r.embedFailed ? ` · ${r.embedFailed} couldn't get search vectors (is nomic-embed-text installed?)` : '') + '.';
    }
    browserState.facetsLoaded = false; // pick up new categories/sources in the Reference Library filters
  }
});

// Typed confirmation for anything that wipes index data.
async function confirmTyped(message) {
  const { ok, value } = await showAppModal(`${message}\n\nType RESET to confirm.`, { cancel: true, okText: 'Reset', inputPlaceholder: 'RESET' });
  return ok && (value || '').trim() === 'RESET';
}

async function runLibraryReset(scope) {
  const res = await window.localAI.libraryReset(scope);
  if (!res.ok) { await showAppAlert(res.error); return; }
  browserState.facetsLoaded = false;
  refreshUploads();
  refreshResearchStatus();
  populateCategorySelect(els.libraryUploadCategory, { allowNew: true });
  const trashNote = res.trashFailed?.length ? `\n\nCouldn't move to the Recycle Bin: ${res.trashFailed.join(', ')}` : '';
  await showAppAlert(`Done — removed ${res.removed.toLocaleString()} document(s).\nA backup of the old library was saved as:\n${res.backupPath}${trashNote}`);
}

els.researchRemoveBtn.onclick = async () => {
  if (!(await confirmTyped('Remove the Research library from the AI\'s index?\n\nYour own uploads stay. Nothing in the Research folder is changed — you can Sync again any time.'))) return;
  runLibraryReset('research');
};
els.libraryResetBtn.onclick = async () => {
  if (!(await confirmTyped('Reset the ENTIRE library?\n\nThis empties the index (your uploads and the Research link) and moves the app\'s own copied files in data\\library to the Recycle Bin. A backup of library.db is saved first. Chats and the Research folder are not touched.'))) return;
  runLibraryReset('all');
};

// Startup: if Research has new/changed items since the last sync, offer a
// sync (never runs one on its own). "Not now" hides it until the catalog
// changes again.
async function checkResearchNotice() {
  const st = await window.localAI.researchStatus();
  if (!st.connected || st.running || !st.catalogChanged || st.noticeDismissed) return;
  els.researchNoticeText.textContent = st.docs
    ? '📚 Your Research library has new or changed items since the last sync.'
    : '📚 Research library found — sync it so the AI can search it (pages stay where they are; nothing is copied).';
  els.researchNotice.classList.remove('hidden');
}
els.researchNoticeSync.onclick = startResearchSync;
els.researchNoticeDismiss.onclick = async () => {
  els.researchNotice.classList.add('hidden');
  await window.localAI.researchDismissNotice();
};

els.browserSearchBtn.onclick = () => runBrowserSearch({ reset: true });
els.browserQuery.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  clearTimeout(browserQueryDebounce);
  runBrowserSearch({ reset: true });
});
// Auto-filters as you type, debounced so a fast typist doesn't fire a
// search per keystroke — only after ~250ms of no further input.
let browserQueryDebounce = null;
els.browserQuery.addEventListener('input', () => {
  clearTimeout(browserQueryDebounce);
  browserQueryDebounce = setTimeout(() => runBrowserSearch({ reset: true }), 250);
});
els.browserCategory.addEventListener('change', () => runBrowserSearch({ reset: true }));
els.browserSource.addEventListener('change', () => runBrowserSearch({ reset: true }));
els.browserLoadMore.addEventListener('click', () => runBrowserSearch({ reset: false }));
els.browserBackBtn.addEventListener('click', showBrowserListView);

// ---- analyze image ----------------------------------------------------------
// Standalone "photo -> identify -> ground in library" utility, distinct from
// the same pipeline living inline in chat (via the 📚 toggle + an attached
// image — see the composer submit handler above). This exists so the
// capability is discoverable and usable without needing to know about that
// toggle, juggle the model dropdown, or type anything. Deliberately doesn't
// touch chat history (see utility:stream in main.js) — a one-off lookup,
// not a saved conversation.
const analyzeState = { base64: null, mimeType: null, model: null, streaming: false, stageLabel: null, stageStart: null };

function resetAnalyzeView() {
  if (analyzeState.streaming) window.localAI.abortGeneration();
  analyzeState.base64 = null;
  analyzeState.mimeType = null;
  analyzeState.model = null;
  analyzeState.streaming = false;
  analyzeState.stageStart = null;
  els.analyzeRunBtn.textContent = 'Analyze';
  els.analyzeFileInput.value = '';
  els.analyzePreview.src = '';
  els.analyzeWorkspace.hidden = true;
  els.analyzeDropzone.hidden = false;
  els.analyzeResults.hidden = true;
  els.analyzeSources.hidden = true;
  els.analyzeAnswer.textContent = '';
}

async function handleAnalyzeFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    await showAppAlert('That\'s not an image file — try dragging a .jpg, .png, .gif, .webp, or .bmp instead.');
    return;
  }
  const buf = await file.arrayBuffer();
  analyzeState.base64 = arrayBufferToBase64(buf);
  analyzeState.mimeType = file.type;
  els.analyzePreview.src = `data:${file.type};base64,${analyzeState.base64}`;
  els.analyzeDropzone.hidden = true;
  els.analyzeWorkspace.hidden = false;
  els.analyzeResults.hidden = true;
  els.analyzeSources.hidden = true;
  els.analyzeAnswer.textContent = '';
  await populateVisionModels(analyzeState, analyzeVisionElements);
}

// Enumerates installed models and checks each one's capabilities in
// parallel to find which are vision-capable — Ollama's own model list
// (/api/tags) doesn't include capabilities, hence the extra round trip per
// model (getModelCapabilities -> /api/show).
// Shared by Analyze Image and Translate's image mode — both need "which
// installed models can actually accept an image" (Ollama's /api/tags
// doesn't report capabilities, hence a getModelCapabilities round trip per
// model). `state` is the calling view's own state object (needs a `.model`
// field); `elements` names that view's select/no-vision-message/run-button.
async function populateVisionModels(state, elements) {
  const [models, catalog] = await Promise.all([window.localAI.listModels('vision'), getMergedCatalog()]);
  const caps = await Promise.all(models.map((m) => window.localAI.getModelCapabilities(m.name, 'vision')));
  const visionModels = models.filter((_, i) => caps[i]?.vision);

  elements.select.innerHTML = '';
  if (visionModels.length === 0) {
    elements.noVisionMsg.hidden = false;
    elements.row.hidden = true;
    state.model = null;
    if (elements.runBtn) elements.runBtn.disabled = true;
    return;
  }
  elements.noVisionMsg.hidden = true;
  const sorted = sortModelsByCategoryWeight(visionModels, catalog);
  const tiersInPlay = new Set(sorted.map((m) => catalog.models?.[m.name]?.tier).filter(Boolean));
  const names = sorted.map((m) => m.name);
  state.model = names.includes(state.model) ? state.model : names[0];
  // Always shown, even with just one option — a single-choice <select> still
  // tells you which model is actually being used, which "hide it, nothing to
  // choose" didn't (you'd otherwise have no way to know at a glance).
  elements.row.hidden = false;
  for (const m of sorted) elements.select.appendChild(new Option(modelOptionLabel(m.name, catalog, tiersInPlay), m.name));
  elements.select.value = state.model;
  if (elements.runBtn) elements.runBtn.disabled = false;
}

const analyzeVisionElements = { select: els.analyzeModelSelect, noVisionMsg: els.analyzeNoVisionModel, row: els.analyzeModelRow, runBtn: els.analyzeRunBtn };
els.analyzeModelSelect.addEventListener('change', () => { analyzeState.model = els.analyzeModelSelect.value; });

// A vision model's first call in a while (or a large photo) can genuinely
// take a long time — well over a minute — to produce a first token, same
// characteristic chat already has (see its own pendingInterval/pending-timer
// comment). Without a visible clock that looks identical to a hang, which
// is exactly what prompted this — "stuck at Generating analysis..., no
// indication of what's going on" was a real slow-vs-hung ambiguity, not
// necessarily a bug. A live elapsed counter plus a Cancel button (reusing
// the same chat:abort the composer's Stop button uses) fixes both: you can
// see it's alive, and you can bail out if it's taking too long regardless.
function setAnalyzeStage(label) {
  analyzeState.stageLabel = label;
  analyzeState.stageStart = Date.now();
  els.analyzeAnswer.textContent = `${label}…`;
}

async function runAnalysis() {
  if (!analyzeState.base64 || !analyzeState.model || analyzeState.streaming) return;
  analyzeState.streaming = true;
  els.analyzeRunBtn.textContent = 'Cancel';
  els.analyzeResults.hidden = false;
  els.analyzeSources.hidden = true;

  setAnalyzeStage('Identifying');
  const stageTimer = setInterval(() => {
    if (analyzeState.stageStart) {
      els.analyzeAnswer.textContent = `${analyzeState.stageLabel}… ${Math.floor((Date.now() - analyzeState.stageStart) / 1000)}s`;
    }
  }, 1000);

  let unsubscribe = null;
  try {
    // Same num_ctx the generate call below will use — see the composer
    // handler's identical comment for why a mismatch forces a wasted reload.
    const analyzeCtxOptions = { num_ctx: Math.max(state.contextSize || 0, 16384) };
    const identified = await window.localAI.libraryIdentifyImage(analyzeState.model, analyzeState.base64, analyzeCtxOptions, 'vision');

    setAnalyzeStage('Searching the reference library');
    const contextResult = identified
      ? await window.localAI.libraryContext(identified, LIBRARY_EMBED_MODEL)
      : { text: '', sources: [] };

    // Always show *something* here — otherwise there's no way to tell "no
    // reference match, this is the model's own knowledge only" apart from
    // "still loading" or a rendering glitch. The distinction matters: an
    // answer grounded in a specific reference doc is more trustworthy than
    // the model's own unsourced guess, and this should never look the same.
    els.analyzeSources.hidden = false;
    if (contextResult.sources.length) {
      const prefix = identified ? `Identified as "${identified}" — using: ` : 'Using: ';
      els.analyzeSources.textContent = prefix + contextResult.sources.map((s) => s.title).join(', ');
    } else {
      els.analyzeSources.textContent = identified
        ? `Identified as "${identified}" — no match found in the reference library; answer below is the model's own knowledge only.`
        : "No reference library match — answer below is the model's own knowledge only.";
    }

    const messages = [];
    if (contextResult.text) {
      messages.push({ role: 'system', content: `Use the following reference material if it's relevant to identifying or describing the image:\n\n${contextResult.text}` });
    }
    messages.push({
      role: 'user',
      content: 'Identify what is in this image in detail. If it is a plant, animal, fungus, or object relevant to survival or off-grid living, clearly state whether it is edible, poisonous, or hazardous, and note any important safety precautions.',
      images: [analyzeState.base64],
    });

    setAnalyzeStage('Generating analysis');
    const streamId = `analyze_${Date.now()}`;
    let full = '';
    let firstToken = true;
    const showAnalysis = replyRenderer(els.analyzeAnswer);
    unsubscribe = window.localAI.onChatToken((data) => {
      if (data.streamId !== streamId) return;
      const token = data.message?.content;
      if (token) {
        if (firstToken) { firstToken = false; analyzeState.stageStart = null; els.analyzeAnswer.textContent = ''; }
        full += token;
        showAnalysis(full);
      }
    });
    // Same context-size floor chat uses whenever an image or library context
    // is involved (see needsContextBump/effectiveCtx in the composer submit
    // handler) — every analyze request has both, so this always applies.
    // Without it, Ollama's own default (as little as 4096 tokens on some
    // setups) can't fit the image + injected reference text + a "detailed"
    // response request, which silently degrades instead of erroring.
    await window.localAI.utilityStream({ streamId, model: analyzeState.model, messages, options: analyzeCtxOptions, purpose: 'vision' });
    if (!full) els.analyzeAnswer.textContent = '(No response — the model returned nothing. Try again, or a different model.)';
  } catch (err) {
    els.analyzeAnswer.textContent = err.message === 'Aborted by user' ? 'Cancelled.' : `Couldn't analyze the image: ${err.message}`;
  } finally {
    clearInterval(stageTimer);
    analyzeState.stageStart = null;
    if (unsubscribe) unsubscribe();
    analyzeState.streaming = false;
    els.analyzeRunBtn.textContent = 'Analyze';
  }
}

els.analyzeBrowseBtn.onclick = () => els.analyzeFileInput.click();
els.analyzeFileInput.addEventListener('change', () => handleAnalyzeFile(els.analyzeFileInput.files[0]));
els.analyzeRunBtn.onclick = () => {
  if (analyzeState.streaming) window.localAI.abortGeneration();
  else runAnalysis();
};
els.analyzeResetBtn.onclick = resetAnalyzeView;

['dragenter', 'dragover'].forEach((evt) => {
  els.analyzeDropzone.addEventListener(evt, (e) => { e.preventDefault(); els.analyzeDropzone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach((evt) => {
  els.analyzeDropzone.addEventListener(evt, (e) => { e.preventDefault(); els.analyzeDropzone.classList.remove('dragover'); });
});
els.analyzeDropzone.addEventListener('drop', (e) => handleAnalyzeFile(e.dataTransfer.files[0]));

// ---- translate ----------------------------------------------------------
// Type/paste text, or drop an image containing text (OCR'd + translated in
// one pass). Deliberately no library grounding here — unlike Analyze
// Image's identify-then-search pipeline, translation isn't a task the
// library has any bearing on, so it's just a straight prompt to
// whichever model applies. Text-only translation needs no vision
// capability — uses the main chat model dropdown's current selection;
// image translation needs a vision-capable model, same detection as
// Analyze Image (see populateVisionModels above).
const translateState = { base64: null, mimeType: null, model: null, textModel: null, streaming: false, stageLabel: null, stageStart: null };
const translateVisionElements = { select: els.translateModelSelect, noVisionMsg: els.translateNoVisionModel, row: els.translateModelRow, runBtn: null };

// Translate's text-only path defaults to whatever's selected in the main
// chat dropdown (state.model), but that dropdown lives in the chat view —
// not visible while you're in this one — and translation quality varies
// enough by model that defaulting silently isn't enough; this lets you
// actually change it here without leaving the screen or touching your
// chat model selection. translateState.textModel is independent of
// state.model once you've picked something here.
async function refreshTranslateTextModelSelect() {
  const [models, catalog] = await Promise.all([window.localAI.listModels(), getMergedCatalog()]);
  const sorted = sortModelsByCategoryWeight(models, catalog);
  const tiersInPlay = new Set(sorted.map((m) => catalog.models?.[m.name]?.tier).filter(Boolean));
  els.translateTextModelSelect.innerHTML = '';
  for (const m of sorted) els.translateTextModelSelect.appendChild(new Option(modelOptionLabel(m.name, catalog, tiersInPlay), m.name));
  if (!translateState.textModel || !models.some((m) => m.name === translateState.textModel)) {
    translateState.textModel = state.model && models.some((m) => m.name === state.model) ? state.model : sorted[0]?.name || null;
  }
  if (translateState.textModel) els.translateTextModelSelect.value = translateState.textModel;
}
els.translateTextModelSelect.addEventListener('change', () => { translateState.textModel = els.translateTextModelSelect.value; });

async function handleTranslateFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    await showAppAlert('That\'s not an image file — try dragging a .jpg, .png, .gif, .webp, or .bmp instead.');
    return;
  }
  const buf = await file.arrayBuffer();
  translateState.base64 = arrayBufferToBase64(buf);
  translateState.mimeType = file.type;
  els.translatePreview.src = `data:${file.type};base64,${translateState.base64}`;
  els.translateDropzone.hidden = true;
  els.translateImageWorkspace.hidden = false;
  els.translateTextModelHint.hidden = true; // an image is now what's being translated, not typed text
  await populateVisionModels(translateState, translateVisionElements);
}

function clearTranslateImage() {
  translateState.base64 = null;
  translateState.mimeType = null;
  els.translateFileInput.value = '';
  els.translatePreview.src = '';
  els.translateImageWorkspace.hidden = true;
  els.translateDropzone.hidden = false;
  els.translateTextModelHint.hidden = false;
  refreshTranslateTextModelSelect();
}

async function runTranslation() {
  if (translateState.streaming) return;
  const text = els.translateTextInput.value.trim();
  const targetLang = els.translateTargetLang.value.trim() || 'English';
  if (!translateState.base64 && !text) {
    await showAppAlert('Type some text or provide an image to translate.');
    return;
  }
  if (translateState.base64 && !translateState.model) {
    await showAppAlert('No vision-capable model is available to read text from the image — pull one from Tools → Models, or clear the image and translate typed text instead.');
    return;
  }

  translateState.streaming = true;
  els.translateRunBtn.textContent = 'Cancel';
  els.translateResults.hidden = false;
  translateState.stageStart = Date.now();
  translateState.stageLabel = translateState.base64 ? 'Reading and translating' : 'Translating';
  els.translateAnswer.textContent = `${translateState.stageLabel}…`;
  const stageTimer = setInterval(() => {
    if (translateState.stageStart) {
      els.translateAnswer.textContent = `${translateState.stageLabel}… ${Math.floor((Date.now() - translateState.stageStart) / 1000)}s`;
    }
  }, 1000);

  const model = translateState.base64 ? translateState.model : translateState.textModel;
  const messages = [];
  let options;
  if (translateState.base64) {
    messages.push({
      role: 'user',
      content: `Transcribe any text visible in this image exactly as written, then translate it to ${targetLang}. Label the two parts clearly ("Original:" / "Translation:"). If there's no legible text in the image, say so.`,
      images: [translateState.base64],
    });
    // Images always get the same treatment as Analyze Image — the injected
    // content (image + reference text) needs real room regardless of
    // whether this happens to force a reload.
    options = { num_ctx: Math.max(state.contextSize || 0, 16384) };
  } else {
    messages.push({ role: 'user', content: `Translate the following text to ${targetLang}. Reply with only the translation, no explanation:\n\n${text}` });
    // Text-only is the common, fast, repeated case — if this model is
    // already loaded, match whatever num_ctx it's *actually* resident with
    // (Ollama's /api/ps reports it) rather than potentially forcing a
    // different one and triggering a pointless reload of a model that's
    // sitting right there in memory. Only fall back to our own floor when
    // it's not loaded yet, since a reload is unavoidable either way then.
    const running = await window.localAI.getRunningModels();
    const resident = running.find((m) => m.name === model);
    options = { num_ctx: resident?.context_length || Math.max(state.contextSize || 0, 16384) };
  }

  let unsubscribe = null;
  try {
    const streamId = `translate_${Date.now()}`;
    let full = '';
    let firstToken = true;
    unsubscribe = window.localAI.onChatToken((data) => {
      if (data.streamId !== streamId) return;
      const token = data.message?.content;
      if (token) {
        if (firstToken) { firstToken = false; translateState.stageStart = null; els.translateAnswer.textContent = ''; }
        full += token;
        els.translateAnswer.textContent = full;
      }
    });
    await window.localAI.utilityStream({ streamId, model, messages, options, purpose: translateState.base64 ? 'vision' : undefined });
    if (!full) els.translateAnswer.textContent = '(No response — the model returned nothing. Try again, or a different model.)';
  } catch (err) {
    els.translateAnswer.textContent = err.message === 'Aborted by user' ? 'Cancelled.' : `Couldn't translate: ${err.message}`;
  } finally {
    clearInterval(stageTimer);
    translateState.stageStart = null;
    if (unsubscribe) unsubscribe();
    translateState.streaming = false;
    els.translateRunBtn.textContent = 'Translate';
  }
}

els.translateTargetLang.value = els.translateLangSelect.value;
els.translateLangSelect.addEventListener('change', () => {
  const isOther = els.translateLangSelect.value === '__other__';
  els.translateTargetLang.hidden = !isOther;
  if (isOther) { els.translateTargetLang.value = ''; els.translateTargetLang.focus(); }
  else els.translateTargetLang.value = els.translateLangSelect.value;
});

els.translateBrowseBtn.onclick = () => els.translateFileInput.click();
els.translateFileInput.addEventListener('change', () => handleTranslateFile(els.translateFileInput.files[0]));
els.translateRemoveImageBtn.onclick = clearTranslateImage;
els.translateRunBtn.onclick = () => {
  if (translateState.streaming) window.localAI.abortGeneration();
  else runTranslation();
};

['dragenter', 'dragover'].forEach((evt) => {
  els.translateDropzone.addEventListener(evt, (e) => { e.preventDefault(); els.translateDropzone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach((evt) => {
  els.translateDropzone.addEventListener(evt, (e) => { e.preventDefault(); els.translateDropzone.classList.remove('dragover'); });
});
els.translateDropzone.addEventListener('drop', (e) => handleTranslateFile(e.dataTransfer.files[0]));

// ---- mobile sync ------------------------------------------------------------
async function refreshMobileStatus() {
  const status = await window.localAI.mobileStatus();
  els.mobileStatus.classList.toggle('running', status.running);
  els.mobileStatus.textContent = status.running ? `Running at ${status.url}` : 'Not running';
  els.mobileToggle.textContent = status.running ? 'Stop' : 'Start';
}
els.mobileToggle.onclick = async () => {
  const status = await window.localAI.mobileStatus();
  if (status.running) await window.localAI.mobileStop();
  else await window.localAI.mobileStart();
  refreshMobileStatus();
};

// ---- system info --------------------------------------------------------
async function refreshSystemInfo() {
  const [info, loc] = await Promise.all([
    window.localAI.getSystemInfo(),
    window.localAI.getModelsLocation(),
  ]);
  els.systemInfo.innerHTML = `
    <div class="row"><span>Platform</span><span>${info.platform} (${info.arch})</span></div>
    <div class="row"><span>RAM</span><span>${info.ramGB} GB</span></div>
    <div class="row"><span>CPU</span><span>${info.cpuModel}</span></div>
    <div class="row"><span>Cores</span><span>${info.cpuCores}</span></div>
    <div class="row"><span>Model storage</span><span>${describeActiveModelsDir(loc)}</span></div>
  `;
  if (!loc.managedByApp) {
    const warning = document.createElement('p');
    warning.className = 'panel-hint';
    warning.style.color = 'var(--danger)';
    warning.textContent =
      'An Ollama instance was already running before this app started, so it\'s in control of where ' +
      'models are stored — see Tools → Models for details, and to change it, quit that instance and ' +
      'reopen this app.';
    els.systemInfo.appendChild(warning);
  }
}

els.ollamaLogRefresh.onclick = async () => {
  els.ollamaLogRefresh.disabled = true;
  try {
    const log = await window.localAI.getOllamaLog();
    els.ollamaLogView.textContent = log || '(empty — Ollama hasn\'t logged anything yet)';
    els.ollamaLogView.scrollTop = els.ollamaLogView.scrollHeight;
  } finally {
    els.ollamaLogRefresh.disabled = false;
  }
};

// ---- model storage location (portable folder vs. a host-machine folder) --
// When an external Ollama owns the port, the folder it serves from isn't
// ours to know for sure — show the likely default rather than our own setting.
function describeActiveModelsDir(loc) {
  if (loc.managedByApp) return loc.activeDir;
  return `External Ollama — likely ${loc.externalDirGuess}`;
}

async function refreshModelsLocation() {
  const loc = await window.localAI.getModelsLocation();
  els.modelsLocationInfo.innerHTML = `
    <div class="row"><span>Portable folder</span><span>${loc.portableDir}</span></div>
    <div class="row"><span>PC folder</span><span>${loc.customDir || '— not set —'}</span></div>
    <div class="row"><span>Currently active</span><span>${describeActiveModelsDir(loc)}</span></div>
  `;
  els.modelsUsePortable.disabled = !loc.customDir;
  els.modelsSyncToHost.disabled = !loc.customDir;
  els.modelsSyncToPortable.disabled = !loc.customDir;

  const existingWarning = els.modelsLocationInfo.parentElement.querySelector('.models-location-warning');
  if (existingWarning) existingWarning.remove();
  if (!loc.managedByApp) {
    const warn = document.createElement('p');
    warn.className = 'panel-hint models-location-warning';
    warn.style.color = 'var(--danger)';
    warn.textContent =
      'An Ollama instance was already running before this app started, so it\'s in control of where ' +
      'models are stored right now — choosing a folder below will be remembered, but won\'t take effect ' +
      'until you quit that instance and reopen this app. Sync still works regardless, since it just ' +
      'copies files between the two folders.';
    els.modelsLocationInfo.insertAdjacentElement('afterend', warn);
  }
}

els.modelsChooseFolder.onclick = async () => {
  els.modelsChooseFolder.disabled = true;
  els.modelsSyncStatus.textContent = '';
  try {
    const result = await window.localAI.chooseModelsFolder();
    if (!result.success) { if (result.error) await showAppAlert(result.error); return; }
  } finally {
    els.modelsChooseFolder.disabled = false;
  }
  await refreshModelsLocation();
};

els.modelsUsePortable.onclick = async () => {
  els.modelsUsePortable.disabled = true;
  await window.localAI.useDefaultModelsFolder();
  await refreshModelsLocation();
};

async function runModelsSync(direction, btn) {
  btn.disabled = true;
  els.modelsSyncStatus.textContent = 'Starting sync…';
  const result = await window.localAI.syncModels(direction);
  btn.disabled = false;
  if (!result.success) {
    els.modelsSyncStatus.textContent = `Sync failed: ${result.error}`;
    return;
  }
  els.modelsSyncStatus.textContent =
    result.filesCopied === 0
      ? 'Already in sync — nothing to copy.'
      : `Synced ${result.filesCopied} file(s), ${(result.bytesCopied / 1024 ** 3).toFixed(2)} GB.`;
  refreshModelsLocation();
}
els.modelsSyncToHost.onclick = () => runModelsSync('toHost', els.modelsSyncToHost);
els.modelsSyncToPortable.onclick = () => runModelsSync('toPortable', els.modelsSyncToPortable);

window.localAI.onModelSyncProgress((p) => {
  if (p.phase === 'start') {
    els.modelsSyncStatus.textContent = p.totalFiles === 0 ? 'Already in sync — nothing to copy.' : `Syncing ${p.totalFiles} file(s)…`;
  } else if (p.phase === 'progress') {
    const pct = p.totalBytes ? Math.round((p.copiedBytes / p.totalBytes) * 100) : 100;
    els.modelsSyncStatus.textContent = `Syncing… ${pct}% (${p.currentFile})`;
  }
});

window.localAI.onOllamaRestartStatus(({ message }) => {
  if (message) els.modelsSyncStatus.textContent = message;
});

// ============================================================ voice input
let mediaRecorder = null;
let audioChunks = [];
let voiceTranscribing = false;

// Whisper's native input format. Converting to this here (rather than
// shipping the recorder's WebM/Opus as-is) is what makes voice input work
// with a stock whisper-server build: those decode only WAV/MP3/FLAC/Vorbis
// unless started with --convert, which needs a separately installed ffmpeg.
const WHISPER_SAMPLE_RATE = 16000;

// Decodes whatever MediaRecorder produced (WebM/Opus in Chromium) with the
// browser's own decoder, then down-mixes to mono and resamples to 16 kHz in
// one pass via an OfflineAudioContext, and wraps the result as a WAV file.
async function audioBlobToWav(blob) {
  const encoded = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(encoded);
  } finally {
    decodeCtx.close();
  }
  const frameCount = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE);
  if (frameCount < 1) throw new Error('the recording was empty');
  const offline = new OfflineAudioContext(1, frameCount, WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination); // 1-channel destination = automatic down-mix
  source.start();
  const rendered = await offline.startRendering();
  return encodeWavPcm16(rendered.getChannelData(0), WHISPER_SAMPLE_RATE);
}

// Float32 samples (-1..1) -> a complete 16-bit PCM mono WAV file.
function encodeWavPcm16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (offset, s) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true); // mono
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function setMicState(mode) {
  els.micBtn.classList.toggle('recording', mode === 'recording');
  els.micBtn.classList.toggle('transcribing', mode === 'transcribing');
  els.micBtn.disabled = mode === 'transcribing';
  els.micBtn.title =
    mode === 'recording' ? 'Recording — click to stop and transcribe'
    : mode === 'transcribing' ? 'Transcribing…'
    : 'Voice input';
}

async function transcribeRecording(blob) {
  voiceTranscribing = true;
  setMicState('transcribing');
  try {
    const wav = await audioBlobToWav(blob);
    const result = await window.localAI.voiceTranscribe(arrayBufferToBase64(wav));
    if (!result.success) {
      await showAppAlert(result.error || 'Transcription failed.');
    } else if (!result.text) {
      await showAppAlert('No speech was detected in that recording — try again, a little closer to the microphone.');
    } else {
      els.input.value = (els.input.value + ' ' + result.text).trim();
      els.input.dispatchEvent(new Event('input'));
      els.input.focus();
    }
  } catch (err) {
    await showAppAlert(`Couldn't process the recording: ${err.message}`);
  } finally {
    voiceTranscribing = false;
    setMicState('idle');
  }
}

els.micBtn.addEventListener('click', async () => {
  if (voiceTranscribing) return;

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  const { available } = await window.localAI.voiceCheck();
  if (!available) {
    await showAppAlert('Voice input isn\'t installed — see SETUP.md for adding the whisper.cpp server (setup script: -WithVoice / --with-voice).');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    await showAppAlert(`Couldn't access a microphone: ${err.message}`);
    return;
  }
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    transcribeRecording(blob);
  };
  mediaRecorder.start();
  setMicState('recording');
});

// ============================================================ exit / shutdown
// Shared by the Exit button and the native titlebar X (main.js intercepts
// the window's close event and asks for this same confirmation instead of
// letting it close straight through — see 'close-requested' below).
let exitConfirmShowing = false;
async function confirmExit() {
  if (exitConfirmShowing) return;
  exitConfirmShowing = true;
  let result;
  try {
    result = await showAppModal(
      'Exit AI Portable? This stops the model runtime and frees any memory it is using.',
      {
        cancel: true,
        checkboxLabel: 'Keep models loaded in memory for faster startup next time',
        checkboxChecked: state.keepModelsLoadedOnExit,
      }
    );
  } finally {
    exitConfirmShowing = false;
  }
  if (!result.ok) return;
  state.keepModelsLoadedOnExit = result.checked;
  els.exitApp.disabled = true;
  els.exitApp.textContent = 'Exiting…';
  els.shutdownOverlay.classList.remove('hidden');
  await window.localAI.quitApp(result.checked);
}
els.exitApp.onclick = confirmExit;
window.localAI.onCloseRequested(confirmExit);
window.localAI.getKeepModelsLoadedPref().then((checked) => { state.keepModelsLoadedOnExit = checked; });
window.localAI.onShutdownStatus(({ message }) => {
  if (message) els.shutdownMessage.textContent = message;
});

// ============================================================ attachments
// Per-message, ephemeral attachments (image / PDF / Word / text) — distinct
// from the Library tab's uploads, which persist and are searched across
// chats. These are only sent for the one message being composed.
// Non-image attachments (PDF/Word/text) don't have a thumbnail to show, so
// they get a small type icon instead — otherwise a chip is just plain text
// with no visual cue at all for what kind of file it is.
function iconForAttachment(a) {
  if (a.kind === 'unsupported') return '⚠️';
  const ext = (a.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  if (ext === '.pdf') return '📄';
  if (ext === '.docx' || ext === '.doc') return '📝';
  return '📃'; // .txt / .md / .text / anything else recognized as plain text
}

function renderAttachmentChip(a, { removable, large } = {}) {
  const chip = document.createElement('div');
  const isLargeImage = large && a.kind === 'image';
  chip.className = 'attachment-chip' + (isLargeImage ? ' large' : '') + (a.kind === 'unsupported' || a.warning ? ' warning' : '');
  if (a.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = `data:${a.mime};base64,${a.base64}`;
    chip.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'chip-icon';
    icon.textContent = iconForAttachment(a);
    chip.appendChild(icon);
  }
  chip.title = a.error || a.warning || a.name;
  // A large image preview already shows the content — the filename label
  // alongside it is redundant clutter, so it's kept as a tooltip only.
  if (!isLargeImage) {
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = a.name;
    chip.appendChild(name);
  }
  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.textContent = '×';
    remove.onclick = () => {
      state.pendingAttachments = state.pendingAttachments.filter((x) => x !== a);
      renderPendingAttachments();
    };
    chip.appendChild(remove);
  }
  return chip;
}

function renderPendingAttachments() {
  els.attachmentsRow.innerHTML = '';
  els.attachmentsRow.classList.toggle('hidden', state.pendingAttachments.length === 0);
  for (const a of state.pendingAttachments) {
    els.attachmentsRow.appendChild(renderAttachmentChip(a, { removable: true }));
  }
}

function clearAttachments() {
  state.pendingAttachments = [];
  renderPendingAttachments();
}

// Shared by both attach paths — the 📁 button's native file picker and
// dropping files directly onto the composer. Each file is handled in its own
// try/catch so one bad file (huge, corrupt, whatever) can't silently swallow
// the rest of the batch or fail with zero visible feedback.
async function addAttachmentFiles(files) {
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const result = await window.localAI.processAttachment({ name: file.name, base64 });
      if (result.kind === 'unsupported') {
        await showAppAlert(result.error || `Unsupported file type: ${file.name}`);
        continue;
      }
      if (result.warning) await showAppAlert(`${file.name}: ${result.warning}`);
      state.pendingAttachments.push({ name: file.name, ...result });
    } catch (err) {
      await showAppAlert(`Couldn't attach "${file.name}": ${err.message}`);
    }
  }
  renderPendingAttachments();
}

els.attachBtn.onclick = () => els.attachFile.click();

els.attachFile.addEventListener('change', async () => {
  const files = [...els.attachFile.files];
  els.attachFile.value = '';
  await addAttachmentFiles(files);
});

// Drag-and-drop onto the composer — dragover must itself be prevented for
// 'drop' to fire at all (the browser default is to navigate to the file).
// Only the composer (not the whole window) is a drop target, so dragging
// something over the message history doesn't suggest it'll do anything.
['dragenter', 'dragover'].forEach((evt) => {
  els.composer.addEventListener(evt, (e) => {
    e.preventDefault();
    els.composer.classList.add('drag-over');
  });
});
['dragleave', 'dragend'].forEach((evt) => {
  els.composer.addEventListener(evt, () => els.composer.classList.remove('drag-over'));
});
els.composer.addEventListener('drop', async (e) => {
  e.preventDefault();
  els.composer.classList.remove('drag-over');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) await addAttachmentFiles(files);
});

// ============================================================ boot
(async function init() {
  const { ready, backend } = await window.localAI.getOllamaStatus();
  setStatus(ready, backend);
  await refreshChatList();
  state.contextSize = await window.localAI.getContextSize(); // so a chat sent before the Models tab is ever opened still honors it
  checkResearchNotice();
})();
