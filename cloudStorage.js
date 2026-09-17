/**
 * config/cloudStorage.js — storage abstraction.
 *
 * Default adapter: LOCAL disk (zero-config, works on any host).
 * To use cloud storage (S3 / Firebase / R2) implement the same 3 functions
 * and export it instead — nothing else in the codebase needs to change.
 * Example S3 impl is sketched at the bottom.
 */
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('../utils/mediaUpload');

const localStorageAdapter = {
  async save(stream, filename) {
    const target = path.join(UPLOAD_DIR, filename);
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.promises.writeFile(target, stream);
    return `/uploads/${filename}`;
  },
  async read(filename) {
    return fs.createReadStream(path.join(UPLOAD_DIR, path.basename(filename)));
  },
  async remove(filename) {
    const target = path.join(UPLOAD_DIR, path.basename(filename));
    if (fs.existsSync(target)) await fs.promises.unlink(target);
  },
};

module.exports = { storageAdapter: localStorageAdapter };

/*
 * ---- AWS S3 adapter sketch (npm i @aws-sdk/client-s3) ----
 * const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
 * const s3 = new S3Client({});
 * module.exports = { storageAdapter: {
 *   async save(stream, filename) {
 *     await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename, Body: stream }));
 *     return `${process.env.S3_PUBLIC_BASE}/${filename}`;
 *   },
 *   async read(filename) { return (await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename }))).Body; },
 *   async remove(filename) { await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: filename })); },
 * }};
 */
