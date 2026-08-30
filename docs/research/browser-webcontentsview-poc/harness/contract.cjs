const { createHash } = require('node:crypto');

function buildPocPartition(workspaceKey, runNonce) {
  if (typeof workspaceKey !== 'string' || !/^[a-f0-9]{64}$/i.test(workspaceKey)) {
    throw new Error('workspaceKey must be a v1 opaque sha256 id');
  }
  if (typeof runNonce !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(runNonce)) {
    throw new Error('runNonce must be a bounded opaque token');
  }
  const suffix = createHash('sha256')
    .update(`${workspaceKey}\u0000default\u0000${runNonce}`)
    .digest('hex')
    .slice(0, 24);
  return `persist:codepilot-browser-poc-${suffix}`;
}

function validateBounds(value, windowBounds) {
  if (!value || typeof value !== 'object') return null;
  const fields = ['x', 'y', 'width', 'height'];
  if (!fields.every((field) => Number.isFinite(value[field]) && Number.isInteger(value[field]))) return null;
  if (value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) return null;
  if (value.width > 4096 || value.height > 4096) return null;
  if (value.x + value.width > windowBounds.width || value.y + value.height > windowBounds.height) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function isAllowedBrowserUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

module.exports = { buildPocPartition, validateBounds, isAllowedBrowserUrl };
