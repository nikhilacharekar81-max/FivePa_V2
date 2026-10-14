import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  workstreamUploadIndex,
  WORKSTREAM_UPLOADS_DIR,
  saveWorkstreamUploadIndex
} from '../store.js';
import { requireAuth, rateLimit } from '../auth.js';
import {
  WORKSTREAM_FILE_URL_PREFIX,
  canAccessWorkstreamFile,
  workstreamFileReferencedBy
} from '../access.js';

export const WORKSTREAM_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const WORKSTREAM_ABANDONED_UPLOAD_TTL_MS = 24 * 3600 * 1000;

// Allowed attachment types. SVG/HTML/JS are deliberately excluded (script-injection risk).
export const WORKSTREAM_ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z',
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.fig', '.psd', '.ai', '.sketch'
]);
export const WORKSTREAM_INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);

export const uploadsRouter = Router();

// Remove uploads that were never attached to a message or delivery (WS-31).
export function cleanupAbandonedWorkstreamUploads() {
  const now = Date.now();
  let changed = false;
  for (const [filename, rec] of Object.entries(workstreamUploadIndex)) {
    if (now - new Date(rec.createdAt).getTime() < WORKSTREAM_ABANDONED_UPLOAD_TTL_MS) continue;
    if (workstreamFileReferencedBy(filename).length > 0) continue;
    try { fs.unlinkSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)); } catch { /* already gone */ }
    delete workstreamUploadIndex[filename];
    changed = true;
  }
  if (changed) saveWorkstreamUploadIndex();
}

setInterval(cleanupAbandonedWorkstreamUploads, 3600_000).unref?.();

// POST /api/workstream/upload
uploadsRouter.post(
  '/api/workstream/upload',
  requireAuth,
  rateLimit(5, 60_000),
  express.raw({ type: '*/*', limit: WORKSTREAM_MAX_UPLOAD_BYTES }),
  (req, res) => {
    try {
      const caller = (req as any).authenticatedUser;
      const rawName = (req.query.name as string) || 'attachment';
      let decodedName: string;
      try { decodedName = decodeURIComponent(rawName); } catch { decodedName = rawName; }
      const safeBase = path.basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
      const ext = path.extname(safeBase).toLowerCase();
      if (!WORKSTREAM_ALLOWED_EXTENSIONS.has(ext)) {
        return res.status(415).json({ error: `File type "${ext || 'unknown'}" is not allowed.` });
      }
      const nameWithoutExt = path.basename(safeBase, path.extname(safeBase));
      const storedFilename = `${Date.now()}_${randomUUID().slice(0, 8)}_${nameWithoutExt}${ext}`;
      const filePath = path.join(WORKSTREAM_UPLOADS_DIR, storedFilename);

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'No file data received' });
      }
      if (buffer.length > WORKSTREAM_MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: 'File is too large (25 MB maximum).' });
      }

      fs.writeFileSync(filePath, buffer);
      workstreamUploadIndex[storedFilename] = {
        ownerId: caller.id,
        originalName: safeBase,
        mime: (req.headers['content-type'] as string) || 'application/octet-stream',
        size: buffer.length,
        createdAt: new Date().toISOString()
      };
      saveWorkstreamUploadIndex();

      const bytes = buffer.length;
      const sizeStr = bytes > 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;

      const mimeType = (req.headers['content-type'] as string) || 'application/octet-stream';

      res.json({
        name: safeBase,
        size: sizeStr,
        url: `${WORKSTREAM_FILE_URL_PREFIX}${storedFilename}`,
        type: mimeType
      });
    } catch (err: any) {
      console.error('Workstream file upload error:', err);
      res.status(500).json({ error: 'Failed to save uploaded file' });
    }
  }
);

// GET /api/workstream/files/:filename
const handleFileDownload = (req: any, res: any) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(WORKSTREAM_UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (!canAccessWorkstreamFile((req as any).authenticatedUser, filename)) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this file.' });
  }

  const parts = filename.split('_');
  const originalName = parts.length > 2 ? parts.slice(2).join('_') : filename;
  const ext = path.extname(filename).toLowerCase();

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.query.download === '1' || !WORKSTREAM_INLINE_EXTENSIONS.has(ext)) {
    return res.download(filePath, originalName);
  }

  res.sendFile(filePath);
};

uploadsRouter.get('/api/workstream/files/:filename', requireAuth, handleFileDownload);
uploadsRouter.get('/api/workstream/file/:filename', requireAuth, handleFileDownload);
