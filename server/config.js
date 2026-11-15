import './env.js';
import path from 'node:path';
import fs from 'node:fs';

export const DATA_DIR = path.resolve(process.env.DEVHUB_DATA || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const PORT = Number(process.env.PORT || 3000);
// Optional: expose a folder of the machine running DevHub as the "Local" pane in the SFTP module.
export const LOCAL_ROOT = process.env.DEVHUB_LOCAL_ROOT ? path.resolve(process.env.DEVHUB_LOCAL_ROOT) : null;
export const ALLOW_REGISTER = process.env.DEVHUB_ALLOW_REGISTER !== '0';
export const BLOCK_PRIVATE = process.env.DEVHUB_BLOCK_PRIVATE === '1';
export const SECURE_COOKIE = process.env.DEVHUB_SECURE_COOKIE === '1';
