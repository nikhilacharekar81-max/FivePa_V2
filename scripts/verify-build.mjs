// Runs before `npm start`. Refuses to start a production server from a stale server.js bundle.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
const fail = (msg) => { console.error(`\n❌ ${msg}\n   Run: npm run build\n`); process.exit(1); };
if (!fs.existsSync('server.js')) fail('server.js is missing.');
if (!fs.existsSync('server.build-stamp.json')) fail('No build stamp found: server.js was not produced by the current build.');
const stamp = JSON.parse(fs.readFileSync('server.build-stamp.json', 'utf-8'));
const current = createHash('sha256').update(fs.readFileSync('server.ts')).digest('hex');
if (stamp.serverTsSha256 !== current) fail('server.js is STALE: server.ts has changed since the last build.');
console.log('✅ server.js matches the current server.ts');
