const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

// Ollama's model store is content-addressed (blobs named by sha256 digest),
// so a same-size file at the destination is already the same content — a
// cheap way to skip re-copying gigabytes of blob that's already there in
// both places, without hashing everything on every sync.
function planCopy(srcRoot, destRoot) {
  const files = listFilesRecursive(srcRoot);
  const plan = [];
  let totalBytes = 0;
  for (const srcFile of files) {
    const rel = path.relative(srcRoot, srcFile);
    const destFile = path.join(destRoot, rel);
    const srcSize = fs.statSync(srcFile).size;
    const needsCopy = !fs.existsSync(destFile) || fs.statSync(destFile).size !== srcSize;
    if (needsCopy) {
      plan.push({ srcFile, destFile, size: srcSize });
      totalBytes += srcSize;
    }
  }
  return { plan, totalBytes, totalFiles: files.length };
}

// Merge-copies everything under srcRoot into destRoot (blobs/ + manifests/),
// skipping files that already match at the destination. onProgress is called
// with { phase: 'start', totalFiles, totalBytes }, then repeatedly with
// { phase: 'progress', copiedBytes, totalBytes, currentFile }, then once with
// { phase: 'done', copiedBytes, totalBytes, filesCopied }.
async function syncModels(srcRoot, destRoot, onProgress) {
  const { plan, totalBytes } = planCopy(srcRoot, destRoot);
  onProgress?.({ phase: 'start', totalFiles: plan.length, totalBytes });

  let copiedBytes = 0;
  for (const { srcFile, destFile, size } of plan) {
    await fsp.mkdir(path.dirname(destFile), { recursive: true });
    await fsp.copyFile(srcFile, destFile);
    copiedBytes += size;
    onProgress?.({ phase: 'progress', copiedBytes, totalBytes, currentFile: path.basename(destFile) });
  }

  onProgress?.({ phase: 'done', copiedBytes, totalBytes, filesCopied: plan.length });
  return { filesCopied: plan.length, bytesCopied: copiedBytes };
}

module.exports = { syncModels, planCopy };
