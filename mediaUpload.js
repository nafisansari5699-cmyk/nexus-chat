/**
 * utils/mediaUpload.js — multer disk-storage handler for media files.
 * Clients upload ALREADY-ENCRYPTED blobs (images, files, voice notes), so the
 * server only ever stores opaque ciphertext at a random, unguessable path.
 */
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB, 10) || 10;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const fs = require('fs');
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    // random capability-URL name; keep no extension (opaque encrypted blob)
    cb(null, crypto.randomBytes(16).toString('hex') + '.bin');
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
});

upload.dest = UPLOAD_DIR;
module.exports = upload;
