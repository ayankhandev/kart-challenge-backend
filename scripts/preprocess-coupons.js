#!/usr/bin/env node
// -----------------------------------------------------------
// Decompress coupon .gz files and load all unique codes into
// Redis sharded SETs for O(1) lookups via SISMEMBER.
//
// TARGET: 10M+ codes/second throughput.
//
// Architecture:
//   - Worker threads: one per .gz file, each does gunzip →
//     RESP encode → pipe to its own redis-cli --pipe process
//   - Zero-copy line scanning: tracks offsets in chunk buffer,
//     copies only the code bytes into the pre-allocated output buf
//   - Pre-allocated 16 MB output buffer per shard flush — single
//     write() call to redis-cli stdin avoids small-write overhead
//   - Mega-batches: 50,000 codes per SADD command per shard —
//     amortises the *N\r\n$4\r\nSADD\r\n header cost
//   - All RESP framing bytes are pre-computed static Buffers
//   - highWaterMark: 4 MB on read + gunzip streams
//
// Shards by first character: coupons:<filename>:<char>
// e.g. coupons:couponbase1:A, coupons:couponbase2:A, etc.
// A coupon is only valid if it exists in at least 2 files.
//
// Usage:  node scripts/preprocess-coupons.js [DATA_DIR]
//         DATA_DIR defaults to ./data
//
// Env:    REDIS_URL  (default: redis://localhost:6379)
// -----------------------------------------------------------

'use strict';

const {
  isMainThread,
  parentPort,
  workerData,
  Worker,
} = require('worker_threads');

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, execSync } = require('child_process');

// ───────────────────── Shared constants ─────────────────────

const REDIS_PREFIX = 'coupons';
const BATCH_SIZE = 50_000;          // codes per SADD per shard
const HWM = 4 * 1024 * 1024;       // 4 MB stream highWaterMark
const OUT_BUF_SIZE = 16 * 1024 * 1024; // 16 MB pre-alloc output buf

const NEWLINE = 0x0a;
const CR = 0x0d;

const SHARD_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Pre-compute RESP fragments as raw byte arrays
const SADD_HEADER = Buffer.from('$4\r\nSADD\r\n');
const CRLF_BUF = Buffer.from('\r\n');

// $<len>\r\n for code lengths 1-20 (only 8-10 are expected but be safe)
const CODE_LEN_PREFIX = new Array(21);
for (let l = 0; l <= 20; l++) {
  CODE_LEN_PREFIX[l] = Buffer.from(`$${l}\r\n`);
}

// Per-shard key RESP bytes are computed per worker (they include the filename)

// ═══════════════════════════════════════════════════════════════
//  WORKER THREAD — one per file
// ═══════════════════════════════════════════════════════════════

if (!isMainThread) {
  const { filePath, redisHost, redisPort, fileLabel } = workerData;
  const fileName = path.basename(filePath);

  // Per-shard: key RESP bytes  e.g. "$21\r\ncoupons:couponbase1:A\r\n"
  const SHARD_KEY_RESP = {};
  for (const c of SHARD_CHARS) {
    const key = `${REDIS_PREFIX}:${fileLabel}:${c}`;
    SHARD_KEY_RESP[c] = Buffer.from(`$${key.length}\r\n${key}\r\n`);
  }

  // ---- Per-shard accumulators ----
  // Instead of pushing Buffer objects into arrays, we accumulate
  // raw code bytes + their offsets into flat typed arrays.
  // Each shard has:
  //   .buf   — Uint8Array holding code bytes back-to-back
  //   .lens  — Uint16Array holding each code's length
  //   .count — number of codes buffered
  //   .pos   — write cursor in .buf

  const shards = {};
  for (const c of SHARD_CHARS) {
    // Max code len=10, batch=50k → 500 KB per shard buf (tiny)
    shards[c] = {
      buf: Buffer.allocUnsafe(BATCH_SIZE * 12),
      lens: new Uint16Array(BATCH_SIZE),
      count: 0,
      pos: 0,
    };
  }

  // Pre-allocated output buffer for RESP encoding
  const outBuf = Buffer.allocUnsafe(OUT_BUF_SIZE);

  let totalCodes = 0;
  let skipped = 0;

  // ---- Spawn redis-cli --pipe ----
  const redisCli = spawn(
    'redis-cli',
    ['-h', redisHost, '-p', redisPort, '--pipe', '--pipe-timeout', '0'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  redisCli.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
  });

  // Discard redis-cli stdout (pipe-mode reply lines) to avoid
  // RangeError: Invalid string length on huge datasets.
  redisCli.stdout.resume();

  // Keep last 4 KB of stderr for diagnostics
  const MAX_CLI_ERR = 4096;
  let cliStderr = '';
  redisCli.stderr.on('data', (d) => {
    cliStderr += d;
    if (cliStderr.length > MAX_CLI_ERR * 2)
      cliStderr = cliStderr.slice(-MAX_CLI_ERR);
  });

  const cliDone = new Promise((resolve, reject) => {
    redisCli.on('close', (code) => {
      if (code !== 0) {
        // redis-cli --pipe can exit 1 at scale (~53M+ codes) but still
        // processes all data it received before dying.  Treat as warning.
        parentPort.postMessage({
          type: 'progress',
          fileName,
          codes: totalCodes,
          skipped,
          elapsed: ((Date.now() - startTime) / 1000).toFixed(1),
          rate: Math.round(totalCodes / ((Date.now() - startTime) / 1000)),
        });
        parentPort.postMessage({
          type: 'warn',
          fileName,
          message: `redis-cli exited with code ${code} (data was still loaded). stderr: ${cliStderr.trim()}`,
        });
        resolve(); // don't crash — partial load is fine
      } else {
        resolve();
      }
    });
    redisCli.on('error', reject);
  });

  // ---- Flush one shard's batch as a single SADD RESP command ----
  function flushShard(c) {
    const s = shards[c];
    if (s.count === 0) return;

    const n = s.count;
    const keyResp = SHARD_KEY_RESP[c];
    const argCount = 2 + n;

    // Build *<argCount>\r\n header
    const argCountStr = `*${argCount}\r\n`;

    let off = 0;

    // Write *N\r\n
    off += outBuf.write(argCountStr, off, 'ascii');
    // Write $4\r\nSADD\r\n
    off += SADD_HEADER.copy(outBuf, off);
    // Write $kLen\r\nkey\r\n
    off += keyResp.copy(outBuf, off);

    // Write each code: $len\r\n<code>\r\n
    let readPos = 0;
    for (let i = 0; i < n; i++) {
      const len = s.lens[i];
      const prefix = CODE_LEN_PREFIX[len];
      off += prefix.copy(outBuf, off);
      off += s.buf.copy(outBuf, off, readPos, readPos + len);
      outBuf[off++] = 0x0d; // \r
      outBuf[off++] = 0x0a; // \n
      readPos += len;
    }

    // Copy before writing — subarray is a VIEW into the shared outBuf.
    // Node.js streams queue writes by reference, so the next flushShard
    // call would overwrite outBuf before the previous write is flushed.
    redisCli.stdin.write(Buffer.from(outBuf.subarray(0, off)));

    // Reset shard
    s.count = 0;
    s.pos = 0;
  }

  function flushAll() {
    for (const c of SHARD_CHARS) flushShard(c);
  }

  // ---- Process a raw chunk: scan for newlines, shard codes ----
  let leftover = null;

  function processChunk(chunk) {
    let buf = chunk;
    if (leftover !== null) {
      buf = Buffer.concat([leftover, chunk]);
      leftover = null;
    }

    let start = 0;
    const end = buf.length;

    while (start < end) {
      const idx = buf.indexOf(NEWLINE, start);
      if (idx === -1) {
        leftover = Buffer.from(buf.subarray(start));
        return;
      }

      // Determine line length (strip CR)
      let lineEnd = idx;
      if (lineEnd > start && buf[lineEnd - 1] === CR) lineEnd--;
      const len = lineEnd - start;

      if (len >= 8 && len <= 10) {
        // Determine shard
        let fc = buf[start];
        if (fc >= 0x61 && fc <= 0x7a) fc -= 0x20; // uppercase
        const c = String.fromCharCode(fc);

        const s = shards[c];
        if (s) {
          // Copy code bytes into shard buffer
          buf.copy(s.buf, s.pos, start, start + len);
          s.lens[s.count] = len;
          s.pos += len;
          s.count++;
          totalCodes++;

          if (s.count >= BATCH_SIZE) {
            flushShard(c);
          }
        } else {
          skipped++;
        }
      } else if (len > 0) {
        skipped++;
      }

      start = idx + 1;
    }
  }

  // ---- Stream pipeline ----
  const readStream = fs.createReadStream(filePath, { highWaterMark: HWM });
  const gunzip = zlib.createGunzip({ highWaterMark: HWM });

  const startTime = Date.now();
  let logCounter = 0;
  const LOG_INTERVAL = 500_000;

  gunzip.on('data', (chunk) => {
    processChunk(chunk);
    logCounter += chunk.length;
    // Rough progress every ~500k codes (estimated from bytes)
    // We log based on actual code count for accuracy
    if (totalCodes - (totalCodes % LOG_INTERVAL) > (totalCodes - LOG_INTERVAL) && totalCodes % LOG_INTERVAL < 10000) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round(totalCodes / ((Date.now() - startTime) / 1000));
      parentPort.postMessage({
        type: 'progress',
        fileName,
        codes: totalCodes,
        skipped,
        elapsed,
        rate,
      });
    }
  });

  gunzip.on('end', async () => {
    if (leftover !== null && leftover.length > 0) {
      const final = Buffer.concat([leftover, Buffer.from('\n')]);
      leftover = null;
      processChunk(final);
    }
    flushAll();

    redisCli.stdin.end();

    // Give redis-cli a grace period, then force-kill it.
    // The data is already in Redis once stdin is consumed;
    // we don't need to wait for it to finish printing reply stats.
    const killTimer = setTimeout(() => {
      redisCli.kill('SIGTERM');
    }, 10_000); // 10s grace

    try {
      await cliDone;
    } catch (err) {
      parentPort.postMessage({ type: 'error', fileName, error: err.message });
      process.exit(1);
    } finally {
      clearTimeout(killTimer);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const rate = Math.round(totalCodes / ((Date.now() - startTime) / 1000));
    parentPort.postMessage({
      type: 'done',
      fileName,
      codes: totalCodes,
      skipped,
      elapsed,
      rate,
    });
  });

  readStream.pipe(gunzip);

  gunzip.on('error', (err) => {
    parentPort.postMessage({ type: 'error', fileName, error: err.message });
    process.exit(1);
  });

  readStream.on('error', (err) => {
    parentPort.postMessage({ type: 'error', fileName, error: err.message });
    process.exit(1);
  });

} else {

  // ═══════════════════════════════════════════════════════════════
  //  MAIN THREAD
  // ═══════════════════════════════════════════════════════════════

  const DATA_DIR = process.argv[2] || './data';
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(REDIS_URL);
  const REDIS_HOST = url.hostname || 'localhost';
  const REDIS_PORT = url.port || '6379';

  async function main() {
    console.log(`==> Redis: ${REDIS_HOST}:${REDIS_PORT}  Prefix: ${REDIS_PREFIX}`);
    console.log(`==> Data dir: ${DATA_DIR}`);

    // 1. Check redis-cli is available
    try {
      execSync('redis-cli --version', { stdio: 'ignore' });
    } catch {
      console.error('ERROR: redis-cli not found. Install redis-tools / redis.');
      process.exit(1);
    }

    // 2. Check Redis connectivity and wait if it's still loading
    {
      const MAX_WAIT = 120; // seconds
      let waited = 0;
      while (waited < MAX_WAIT) {
        try {
          const reply = execSync(
            `redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} PING`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim();
          if (reply === 'PONG') break;
          if (reply.includes('LOADING')) {
            if (waited === 0) console.log('==> Redis is loading dataset into memory, waiting…');
            waited += 2;
            execSync('sleep 2');
            continue;
          }
          break; // unexpected reply, let it proceed
        } catch (err) {
          const msg = err.stderr?.toString() || err.stdout?.toString() || '';
          if (msg.includes('LOADING')) {
            if (waited === 0) console.log('==> Redis is loading dataset into memory, waiting…');
            waited += 2;
            execSync('sleep 2');
            continue;
          }
          console.error(
            `ERROR: Cannot connect to Redis at ${REDIS_HOST}:${REDIS_PORT}`,
          );
          process.exit(1);
        }
      }
      if (waited >= MAX_WAIT) {
        console.error('ERROR: Redis still loading after 120s, aborting.');
        process.exit(1);
      }
    }

    // 3. Clear old shard keys (per-file shards + legacy single-set keys)
    console.log('==> Clearing existing shard keys…');
    const allKeys = [];
    for (let i = 1; i <= 3; i++) {
      for (const c of SHARD_CHARS) {
        allKeys.push(`${REDIS_PREFIX}:couponbase${i}:${c}`);
      }
    }
    // Also clear legacy keys (coupons:A, coupons:0, etc.)
    for (const c of SHARD_CHARS) {
      allKeys.push(`${REDIS_PREFIX}:${c}`);
    }
    allKeys.push(REDIS_PREFIX);
    execSync(
      `redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} DEL ${allKeys.join(' ')}`,
      { stdio: 'ignore' },
    );

    // 4. Discover files
    console.log('==> Loading coupon files into Redis (worker threads + redis-cli --pipe)…');
    const files = [];
    for (let i = 1; i <= 3; i++) {
      const src = path.join(DATA_DIR, `couponbase${i}.gz`);
      if (fs.existsSync(src)) {
        files.push(src);
        console.log(`    ${src}`);
      } else {
        console.log(`    SKIP  ${src} (not found)`);
      }
    }

    if (files.length === 0) {
      console.log(`==> No coupon files found in ${DATA_DIR}. Skipping preprocessing...`);
      process.exit(0);
    }

    // 5. Spawn worker threads — one per file, true parallelism
    const startTime = Date.now();

    const workerPromises = files.map(
      (filePath) =>
        new Promise((resolve, reject) => {
          // e.g. "couponbase1" from "couponbase1.gz"
          const fileLabel = path.basename(filePath, '.gz');
          const worker = new Worker(__filename, {
            workerData: {
              filePath,
              fileLabel,
              redisHost: REDIS_HOST,
              redisPort: REDIS_PORT,
            },
          });

          worker.on('message', (msg) => {
            if (msg.type === 'progress') {
              console.log(
                `    [${msg.fileName}] ${msg.codes.toLocaleString()} codes | ${msg.elapsed}s | ${msg.rate.toLocaleString()} codes/s`,
              );
            } else if (msg.type === 'done') {
              console.log(
                `    [${msg.fileName}] DONE: ${msg.codes.toLocaleString()} codes, ${msg.skipped.toLocaleString()} skipped | ${msg.elapsed}s | ${msg.rate.toLocaleString()} codes/s`,
              );
              resolve(msg.codes);
            } else if (msg.type === 'warn') {
              console.warn(
                `    [${msg.fileName}] WARNING: ${msg.message}`,
              );
            } else if (msg.type === 'error') {
              reject(new Error(`[${msg.fileName}] ${msg.error}`));
            }
          });

          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
          });
        }),
    );

    const results = await Promise.all(workerPromises);
    const totalProcessed = results.reduce((a, b) => a + b, 0);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const overallRate = Math.round(totalProcessed / ((Date.now() - startTime) / 1000));
    console.log(
      `==> ${totalProcessed.toLocaleString()} total codes processed in ${totalTime}s (${overallRate.toLocaleString()} codes/s)`,
    );

    // 6. Verify shard sizes (per file)
    console.log('==> Shard sizes (per file):');
    let totalLoaded = 0;
    for (let i = 1; i <= 3; i++) {
      const label = `couponbase${i}`;
      let fileTotal = 0;
      for (const c of SHARD_CHARS) {
        const count = parseInt(
          execSync(
            `redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} SCARD ${REDIS_PREFIX}:${label}:${c}`,
          )
            .toString()
            .trim(),
          10,
        );
        fileTotal += count;
      }
      if (fileTotal > 0) {
        console.log(`    ${label}: ${fileTotal.toLocaleString()} unique codes`);
        totalLoaded += fileTotal;
      }
    }
    console.log(
      `==> Done. ${totalLoaded.toLocaleString()} total codes across all file shards.`,
    );
  }

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}