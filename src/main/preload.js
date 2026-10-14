const { contextBridge, ipcRenderer } = require('electron');

// Every capability the renderer can reach is listed here, explicitly.
// contextIsolation + no nodeIntegration (see main.js) means this is the
// entire trusted surface — nothing else is reachable from the web content.
contextBridge.exposeInMainWorld('localAI', {
  // -- chats --------------------------------------------------------
  createChat: () => ipcRenderer.invoke('chat:create'),
  listChats: () => ipcRenderer.invoke('chat:list'),
  getHistory: (chatId) => ipcRenderer.invoke('chat:history', chatId),
  renameChat: (chatId, title) => ipcRenderer.invoke('chat:rename', { chatId, title }),
  deleteChat: (chatId) => ipcRenderer.invoke('chat:delete', chatId),
  clearAllChats: () => ipcRenderer.invoke('chat:clear-all'),
  generateChatTitle: (model, chatId, text) => ipcRenderer.invoke('chat:generate-title', { model, chatId, text }),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  utilityStream: (payload) => ipcRenderer.invoke('utility:stream', payload),
  saveAssistantMessage: (chatId, content) => ipcRenderer.invoke('chat:save-assistant-message', { chatId, content }),
  abortGeneration: () => ipcRenderer.invoke('chat:abort'),
  exportChat: (chatId, title) => ipcRenderer.invoke('chat:export', { chatId, title }),
  onChatToken: (cb) => on('chat-token', cb),

  // -- models ---------------------------------------------------------
  // `purpose` is optional: 'vision' targets the image-tools runtime (which
  // may be Ollama even while chat uses LM Studio); omitted = chat runtime.
  listModels: (purpose) => ipcRenderer.invoke('ollama:list-models', purpose),
  getCurrentModel: () => ipcRenderer.invoke('ollama:current-model'),
  setCurrentModel: (name) => ipcRenderer.invoke('ollama:set-model', name),
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  onOllamaStatus: (cb) => on('ollama-status', cb),
  getRunningModels: (purpose) => ipcRenderer.invoke('ollama:running-models', purpose),
  getModelCapabilities: (name, purpose) => ipcRenderer.invoke('ollama:model-capabilities', name, purpose),

  // -- chat runtime (Ollama vs. LM Studio) ------------------------------
  getBackendSettings: () => ipcRenderer.invoke('backend:get'),
  setBackendSettings: (patch) => ipcRenderer.invoke('backend:set', patch),

  // -- model storage location (portable folder vs. a host-machine folder) --
  getModelsLocation: () => ipcRenderer.invoke('models:get-location'),
  chooseModelsFolder: () => ipcRenderer.invoke('models:choose-folder'),
  useDefaultModelsFolder: () => ipcRenderer.invoke('models:use-portable'),
  syncModels: (direction) => ipcRenderer.invoke('models:sync', direction),
  onModelSyncProgress: (cb) => on('model-sync-progress', cb),
  onOllamaRestartStatus: (cb) => on('ollama-restart-status', cb),

  // -- model catalog / downloads ---------------------------------------
  getCatalog: () => ipcRenderer.invoke('catalog:list'),
  getCatalogAllTiers: () => ipcRenderer.invoke('catalog:list-all-tiers'),
  getDownloadStatus: () => ipcRenderer.invoke('catalog:status'),
  pullModel: (name) => ipcRenderer.invoke('catalog:pull', name),
  pullMissingModels: () => ipcRenderer.invoke('catalog:pull-missing'),
  cancelDownload: (name) => ipcRenderer.invoke('catalog:cancel', name),
  getCatalogFileInfo: () => ipcRenderer.invoke('catalog:file-info'),
  revealCatalogFile: (tier) => ipcRenderer.invoke('catalog:reveal-file', tier),
  deleteModel: (name) => ipcRenderer.invoke('catalog:delete', name),
  onPullProgress: (cb) => on('pull-progress', cb),
  onPullComplete: (cb) => on('pull-complete', cb),
  onPullError: (cb) => on('pull-error', cb),

  // -- catalog GPU-size tiers --------------------------------------------
  getCatalogTiers: () => ipcRenderer.invoke('catalog:tiers'),
  getSelectedCatalogTiers: () => ipcRenderer.invoke('catalog:get-selected-tiers'),
  setSelectedCatalogTiers: (tiers) => ipcRenderer.invoke('catalog:set-selected-tiers', tiers),

  // -- context length (num_ctx) ------------------------------------------
  getContextSizePresets: () => ipcRenderer.invoke('settings:context-size-presets'),
  getContextSize: () => ipcRenderer.invoke('settings:get-context-size'),
  setContextSize: (size) => ipcRenderer.invoke('settings:set-context-size', size),

  // -- mobile sync server -----------------------------------------------
  mobileStart: () => ipcRenderer.invoke('mobile:start'),
  mobileStop: () => ipcRenderer.invoke('mobile:stop'),
  mobileStatus: () => ipcRenderer.invoke('mobile:status'),

  // -- voice input ------------------------------------------------------
  voiceCheck: () => ipcRenderer.invoke('voice:check'),
  voiceTranscribe: (base64Audio) => ipcRenderer.invoke('voice:transcribe', base64Audio),

  // -- library (local document search) -----------------------------------
  libraryUpload: (payload) => ipcRenderer.invoke('library:upload', payload),
  libraryListUploads: () => ipcRenderer.invoke('library:list-uploads'),
  libraryDeleteUpload: (id) => ipcRenderer.invoke('library:delete-upload', id),
  libraryReadUpload: (id) => ipcRenderer.invoke('library:read-upload', id),
  librarySearch: (query, embedModel) => ipcRenderer.invoke('library:search', { query, embedModel }),
  libraryContext: (query, embedModel) => ipcRenderer.invoke('library:context', { query, embedModel }),
  libraryIdentifyImage: (model, imageBase64, options, purpose) => ipcRenderer.invoke('library:identify-image', { model, imageBase64, options, purpose }),
  libraryBrowse: (payload) => ipcRenderer.invoke('library:browse', payload),
  libraryBrowseFacets: () => ipcRenderer.invoke('library:browse-facets'),
  libraryGetDoc: (id) => ipcRenderer.invoke('library:get-doc', id),
  libraryOpenPdf: (id) => ipcRenderer.invoke('library:open-pdf', id),

  // -- chat attachments -----------------------------------------------------
  processAttachment: (payload) => ipcRenderer.invoke('attachment:process', payload),

  // -- app lifecycle --------------------------------------------------------
  quitApp: (keepLoaded) => ipcRenderer.invoke('app:quit', { keepLoaded }),
  getKeepModelsLoadedPref: () => ipcRenderer.invoke('app:get-keep-loaded-pref'),
  onShutdownStatus: (cb) => on('shutdown-status', cb),
  onCloseRequested: (cb) => on('close-requested', cb),

  // -- misc ---------------------------------------------------------------
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getOllamaLog: () => ipcRenderer.invoke('ollama:get-log'),
});

function on(channel, cb) {
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
