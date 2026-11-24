import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  version: '3.1.0',
  concurrency: 12,
  retries: 3,
  retryDelayMs: 800,
  requestTimeoutMs: 30000,
  tempDir: path.join(__dirname, 'temp_downloads'),
  outputDir: __dirname,
  cleanupTempAfterSuccess: true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    'Referer': 'https://superspl.at/',
    'Origin': 'https://superspl.at'
  }
};

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function log(tag, msg) {
  const colorMap = {
    INFO: COLORS.cyan,
    ANALYSIS: COLORS.cyan,
    SUCCESS: COLORS.green,
    WARN: COLORS.yellow,
    ERR: COLORS.red
  };
  const color = colorMap[tag] || '';
  console.log(`${color}[${tag}]${COLORS.reset} ${msg}`);
}

function checkEnvironment() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < 18) {
    throw new Error(`Node.js 18 or higher is required (detected: ${process.versions.node}).`);
  }
}

async function fetchWithRetry(url, type = 'buffer', { allowForbiddenAsMissing = false } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= CONFIG.retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const res = await fetch(url, {
        headers: CONFIG.headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.status === 404 || (allowForbiddenAsMissing && res.status === 403)) {
        return { ok: false, status: res.status, data: null };
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (${res.statusText})`);
      }

      let data;
      if (type === 'json') {
        data = await res.json();
      } else if (type === 'text') {
        data = await res.text();
      } else {
        data = Buffer.from(await res.arrayBuffer());
      }

      return { ok: true, status: res.status, data };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err.name === 'AbortError' ? new Error(`Request timeout (${CONFIG.requestTimeoutMs}ms)`) : err;

      if (attempt < CONFIG.retries) {
        const delay = CONFIG.retryDelayMs * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastErr?.message || 'Unknown error'}`);
}

async function resolveSuperSplatCdn(rawInput) {
  const trimmed = rawInput.trim().replace(/^["']|["']$/g, '');

  if (trimmed.includes('cloudfront.net') || /\/(lod-meta\.json|meta\.json)(\?.*)?$/i.test(trimmed)) {
    const clean = trimmed.replace(/\/(lod-meta\.json|meta\.json)(\?.*)?$/i, '').replace(/\/+$/, '') + '/';
    const idMatch = clean.match(/\/([a-zA-Z0-9_-]+)\/(v\d+)\/$/);
    return {
      sceneId: idMatch ? idMatch[1] : `custom_${Date.now()}`,
      version: idMatch ? idMatch[2] : 'v1',
      cdnBase: clean,
      directAssetUrl: null
    };
  }

  const idMatch = trimmed.match(/(?:scene\/|[?&]id=|^)([a-zA-Z0-9_-]{6,20})(?:[/?#]|$)/);
  if (!idMatch) {
    throw new Error(`Invalid SuperSplat scene link or ID: "${trimmed}"`);
  }

  const sceneId = idMatch[1];
  log('INFO', `Normalized link format: https://superspl.at/s?id=${sceneId}`);
  log('ANALYSIS', `Input ID: ${sceneId}`);

  const endpoints = [
    `https://superspl.at/scene/${sceneId}`,
    `https://superspl.at/s?id=${sceneId}`
  ];

  for (const endpoint of endpoints) {
    log('ANALYSIS', `Querying endpoint: ${endpoint}...`);
    try {
      const res = await fetchWithRetry(endpoint, 'text');
      if (!res.ok || !res.data) continue;

      // 1. Check if the HTML contains a direct file URL (.ply, .splat, .sog, meta.json, lod-meta.json)
      const directFileMatch = res.data.match(
        /https:\/\/[a-z0-9-]+\.cloudfront\.net\/[a-zA-Z0-9_-]+\/v\d+\/[a-zA-Z0-9._-]+\.(?:ply|splat|sog|json)/i
      );

      // 2. Check for the CDN base directory
      const cdnMatch = res.data.match(/https:\/\/[a-z0-9-]+\.cloudfront\.net\/[a-zA-Z0-9_-]+\/(v\d+)\//i);
      if (cdnMatch) {
        const cdnBase = cdnMatch[0];
        const version = cdnMatch[1];
        log('ANALYSIS', `Success! Detected CDN base: ${cdnBase}`);
        return {
          sceneId,
          version,
          cdnBase,
          directAssetUrl: directFileMatch ? directFileMatch[0] : null
        };
      }
    } catch {
      // Try next endpoint
    }
  }

  throw new Error(
    `Could not locate CDN base for scene "${sceneId}". Make sure the scene is public and the link is valid.`
  );
}

async function runPool(tasks, concurrency) {
  if (tasks.length === 0) return;

  let idx = 0;
  let completed = 0;
  const total = tasks.length;
  const isTTY = Boolean(process.stdout.isTTY);

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (idx < total) {
      const current = idx++;
      await tasks[current]();
      completed++;

      if (isTTY) {
        process.stdout.write(`\rProcessed files: ${completed} / ${total}`);
      } else if (completed % 25 === 0 || completed === total) {
        console.log(`Processed files: ${completed} / ${total}`);
      }
    }
  });

  await Promise.all(workers);
  if (isTTY) process.stdout.write('\n');
}

async function downloadStreamedSog(cdnBase, sceneDir, lodMeta) {
  if (!Array.isArray(lodMeta.filenames) || lodMeta.filenames.length === 0) {
    throw new Error('Invalid lod-meta.json: missing or empty filenames array.');
  }

  log('INFO', 'Detected streamed model (Streamed SOG).');

  await fs.mkdir(sceneDir, { recursive: true });
  await fs.writeFile(path.join(sceneDir, 'lod-meta.json'), JSON.stringify(lodMeta, null, 2));

  const webpTasks = [];
  let successCount = 1;
  let failedCount = 0;

  const metaTasks = lodMeta.filenames.map((relMetaPath) => async () => {
    const res = await fetchWithRetry(`${cdnBase}${relMetaPath}`, 'json');
    if (!res.ok || !res.data) {
      failedCount++;
      log('WARN', `Missing chunk manifest: ${relMetaPath}`);
      return;
    }

    const localMetaPath = path.join(sceneDir, ...relMetaPath.split('/'));
    await fs.mkdir(path.dirname(localMetaPath), { recursive: true });
    await fs.writeFile(localMetaPath, JSON.stringify(res.data, null, 2));
    successCount++;

    const chunkDir = path.posix.dirname(relMetaPath);
    const filesInChunk = new Set();

    for (const section of Object.values(res.data)) {
      if (section && Array.isArray(section.files)) {
        for (const fileName of section.files) {
          filesInChunk.add(fileName);
        }
      }
    }

    for (const fileName of filesInChunk) {
      const relAsset = chunkDir === '.' ? fileName : `${chunkDir}/${fileName}`;
      webpTasks.push(async () => {
        const assetRes = await fetchWithRetry(`${cdnBase}${relAsset}`, 'buffer');
        if (assetRes.ok && assetRes.data && assetRes.data.length > 0) {
          const outPath = path.join(sceneDir, ...relAsset.split('/'));
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, assetRes.data);
          successCount++;
        } else {
          failedCount++;
          log('WARN', `Failed to download asset: ${relAsset}`);
        }
      });
    }
  });

  log('INFO', `Fetching chunk manifests (${metaTasks.length} tasks)...`);
  await runPool(metaTasks, CONFIG.concurrency);

  log('INFO', `Downloading assets (${webpTasks.length} tasks)...`);
  await runPool(webpTasks, CONFIG.concurrency);

  if (failedCount > 0) {
    throw new Error(`Incomplete download: ${failedCount} files failed (${successCount} succeeded).`);
  }

  log('INFO', `Download complete! Success: ${successCount} files.`);
}

async function downloadSingleSog(cdnBase, sceneDir, meta) {
  log('INFO', 'Detected standard SOG model (meta.json).');
  await fs.mkdir(sceneDir, { recursive: true });
  await fs.writeFile(path.join(sceneDir, 'meta.json'), JSON.stringify(meta, null, 2));

  const files = new Set();
  for (const section of Object.values(meta)) {
    if (section && Array.isArray(section.files)) {
      for (const fileName of section.files) {
        files.add(fileName);
      }
    }
  }

  let successCount = 1;
  let failedCount = 0;

  const tasks = Array.from(files).map((fileName) => async () => {
    const res = await fetchWithRetry(`${cdnBase}${fileName}`, 'buffer');
    if (res.ok && res.data && res.data.length > 0) {
      await fs.writeFile(path.join(sceneDir, fileName), res.data);
      successCount++;
    } else {
      failedCount++;
      log('WARN', `Failed to download asset: ${fileName}`);
    }
  });

  log('INFO', `Downloading assets (${tasks.length} tasks)...`);
  await runPool(tasks, CONFIG.concurrency);

  if (failedCount > 0) {
    throw new Error(`Incomplete download: ${failedCount} files failed.`);
  }

  log('INFO', `Download complete! Success: ${successCount} files.`);
}

function resolveSplatTransformCommand(inputPath, outputPlyPath) {
  const isWin = process.platform === 'win32';
  const localBin = path.join(
    __dirname,
    'node_modules',
    '.bin',
    isWin ? 'splat-transform.cmd' : 'splat-transform'
  );

  if (fsSync.existsSync(localBin)) {
    return isWin
      ? { cmd: 'cmd.exe', args: ['/c', localBin, '-w', inputPath, outputPlyPath] }
      : { cmd: localBin, args: ['-w', inputPath, outputPlyPath] };
  }

  return isWin
    ? { cmd: 'cmd.exe', args: ['/c', 'npx', '--yes', '@playcanvas/splat-transform', '-w', inputPath, outputPlyPath] }
    : { cmd: 'npx', args: ['--yes', '@playcanvas/splat-transform', '-w', inputPath, outputPlyPath] };
}

async function convertToPly(inputPath, outputPlyPath) {
  await fs.mkdir(path.dirname(outputPlyPath), { recursive: true });
  log('INFO', `Converting to PLY -> ${outputPlyPath}`);

  const { cmd, args } = resolveSplatTransformCommand(inputPath, outputPlyPath);

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: false
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to launch splat-transform: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`splat-transform exited with error code: ${code}`));
    });
  });

  const stat = await fs.stat(outputPlyPath).catch(() => null);
  if (!stat || stat.size === 0) {
    throw new Error('Conversion completed, but the output .ply file is missing or empty.');
  }
}

async function main() {
  checkEnvironment();
  console.log('=== SuperSplat 3DGS Downloader ===');

  let userInput = process.argv[2];
  if (!userInput) {
    const rl = readline.createInterface({ input, output });
    try {
      userInput = await rl.question('Enter scene link or ID: ');
    } finally {
      rl.close();
    }
  }

  if (!userInput || !userInput.trim()) {
    log('ERR', 'No scene link or ID provided.');
    process.exitCode = 1;
    return;
  }

  const { sceneId, version, cdnBase, directAssetUrl } = await resolveSuperSplatCdn(userInput);
  log('INFO', `Final CDN address: ${cdnBase}`);
  log('INFO', 'Fetching manifest...');

  const sceneDir = path.join(CONFIG.tempDir, `${sceneId}_${version}`);
  const outputPly = path.join(CONFIG.outputDir, `model_${sceneId}_${version}.ply`);

  await fs.rm(sceneDir, { recursive: true, force: true });

  try {
    // 1. Try Streamed SOG (lod-meta.json)
    const lodMetaRes = await fetchWithRetry(`${cdnBase}lod-meta.json`, 'json', { allowForbiddenAsMissing: true });
    if (lodMetaRes.ok && lodMetaRes.data) {
      await downloadStreamedSog(cdnBase, sceneDir, lodMetaRes.data);
      await convertToPly(path.join(sceneDir, 'lod-meta.json'), outputPly);
      log('SUCCESS', `Model successfully converted and saved as: ${path.basename(outputPly)}`);
      return;
    }

    // 2. Try Standard SOG (meta.json)
    const metaRes = await fetchWithRetry(`${cdnBase}meta.json`, 'json', { allowForbiddenAsMissing: true });
    if (metaRes.ok && metaRes.data) {
      await downloadSingleSog(cdnBase, sceneDir, metaRes.data);
      await convertToPly(path.join(sceneDir, 'meta.json'), outputPly);
      log('SUCCESS', `Model successfully converted and saved as: ${path.basename(outputPly)}`);
      return;
    }

    // 3. Try Direct Single-File Formats (.sog, .compressed.ply, .ply, .splat)
    const candidateFiles = [
      directAssetUrl ? path.posix.basename(new URL(directAssetUrl).pathname) : null,
      'scene.sog',
      'model.sog',
      'scene.compressed.ply',
      'model.compressed.ply',
      'scene.ply',
      'model.ply',
      'scene.splat'
    ].filter(Boolean);

    for (const fileName of new Set(candidateFiles)) {
      const fileRes = await fetchWithRetry(`${cdnBase}${fileName}`, 'buffer', { allowForbiddenAsMissing: true });
      if (fileRes.ok && fileRes.data && fileRes.data.length > 0) {
        log('INFO', `Detected single-file model: ${fileName}`);
        await fs.mkdir(sceneDir, { recursive: true });
        const tempFilePath = path.join(sceneDir, fileName);
        await fs.writeFile(tempFilePath, fileRes.data);

        if (fileName.endsWith('.ply') && !fileName.endsWith('.compressed.ply')) {
          await fs.copyFile(tempFilePath, outputPly);
        } else {
          await convertToPly(tempFilePath, outputPly);
        }

        log('SUCCESS', `Model successfully converted and saved as: ${path.basename(outputPly)}`);
        return;
      }
    }

    throw new Error(
      `No accessible scene manifest or model file found at ${cdnBase} (CloudFront returned 403/404 for standard filenames).`
    );
  } finally {
    if (CONFIG.cleanupTempAfterSuccess) {
      await fs.rm(sceneDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((err) => {
  log('ERR', err.message);
  process.exitCode = 1;
});
