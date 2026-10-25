const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');
const readline = require('readline');
const { URL } = require('url');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
            let data = '';
            if (res.statusCode !== 200 && res.statusCode !== 301 && res.statusCode !== 302) {
                res.resume();
                return resolve(null);
            }
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', () => resolve(null));
    });
}

function downloadFile(url, destPath, forceFresh = false) {
    return new Promise((resolve) => {
        if (!forceFresh && fs.existsSync(destPath) && fs.statSync(destPath).size > 10) {
            return resolve(true);
        }
        const options = {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept-Encoding': 'gzip, deflate' 
            }
        };
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(false);
            }
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            
            const fileStream = fs.createWriteStream(destPath);
            
            if (res.headers['content-encoding'] === 'gzip') {
                const gunzip = zlib.createGunzip();
                res.pipe(gunzip).pipe(fileStream);
            } else {
                res.pipe(fileStream);
            }

            fileStream.on('finish', () => {
                fileStream.close();
                resolve(true);
            });
            fileStream.on('error', () => resolve(false));
        }).on('error', () => resolve(false));
    });
}

async function resolveCdnBase(input) {
    input = input.trim();
    
    if (input.includes('cloudfront.net')) {
        const match = input.match(/(https:\/\/[a-zA-Z0-9.-]+\.cloudfront\.net\/[a-zA-Z0-9_-]+\/v[0-9]+\/)/);
        if (match) return match[1];
    }

    let modelId = input;
    try {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            const parsedUrl = new URL(input);
            const queryId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('s') || parsedUrl.searchParams.get('model');
            if (queryId) {
                modelId = queryId;
            } else {
                const segments = parsedUrl.pathname.split('/').filter(Boolean);
                if (segments.length > 0) {
                    modelId = segments[segments.length - 1];
                }
            }
        }
    } catch (e) {}

    console.log(`[ANALYSIS] Input ID: ${modelId}`);

    const targetUrls = [
        `https://superspl.at/scene/${modelId}`,
        `https://superspl.at/s?id=${modelId}`
    ];

    for (const targetUrl of targetUrls) {
        console.log(`[ANALYSIS] Querying endpoint: ${targetUrl}...`);
        const html = await fetchUrl(targetUrl);
        if (html) {
            const matches = html.match(/https:\/\/[a-zA-Z0-9.-]+\.cloudfront\.net\/[^\s"'<>]+/g);
            if (matches && matches.length > 0) {
                const bestMatch = matches.find(m => m.includes('/v')) || matches[0];
                let base = bestMatch;
                if (base.includes('lod-meta.json')) {
                    base = base.split('lod-meta.json')[0];
                } else if (base.includes('meta.json')) {
                    base = base.split('meta.json')[0];
                } else {
                    const vMatch = base.match(/(https:\/\/[a-zA-Z0-9.-]+\.cloudfront\.net\/[a-zA-Z0-9_-]+\/v[0-9]+\/)/);
                    if (vMatch) base = vMatch[1];
                }

                if (!base.endsWith('/')) base += '/';
                console.log(`[ANALYSIS] Success! Detected CDN base: ${base}`);
                return base;
            }
        }
    }

    return `https://d28zzqy0iyovbz.cloudfront.net/${modelId}/v2/`;
}

async function main() {
    console.log("=== SuperSplat 3DGS Downloader ===");
    let input = await askQuestion("Enter scene link or ID: ");
    input = input.trim();

    let modelId = input;
    try {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            const parsedUrl = new URL(input);
            const queryId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('s') || parsedUrl.searchParams.get('model');
            if (queryId) {
                modelId = queryId;
            } else {
                const segments = parsedUrl.pathname.split('/').filter(Boolean);
                if (segments.length > 0) {
                    modelId = segments[segments.length - 1];
                }
            }
        }
    } catch (e) {}

    const normalizedUrl = `https://superspl.at/s?id=${modelId}`;
    console.log(`[INFO] Normalized link format: ${normalizedUrl}`);
    
    const cdnBase = await resolveCdnBase(normalizedUrl);
    console.log(`[INFO] Final CDN address: ${cdnBase}`);
    
    const parts = cdnBase.split('/').filter(Boolean);
    const modelVersionFolder = parts[parts.length - 1]; 
    const modelHash = parts[parts.length - 2] || 'model';
    
    const workDir = process.cwd();
    const baseDir = path.join(workDir, 'items_structured', modelHash, modelVersionFolder);

    console.log(`[INFO] Fetching manifest...`);
    
    let isStreamed = false;
    let manifestName = 'lod-meta.json';
    const manifestPath = path.join(baseDir, 'lod-meta.json');

    let metaSuccess = await downloadFile(cdnBase + 'lod-meta.json', manifestPath, true);
    
    if (metaSuccess) {
        try {
            const content = fs.readFileSync(manifestPath, 'utf8');
            JSON.parse(content);
            isStreamed = true;
            console.log(`[INFO] Detected and unpacked streamed model (Streamed SOG).`);
        } catch (e) {
            metaSuccess = false;
        }
    }

    if (!metaSuccess) {
        manifestName = 'meta.json';
        const altManifestPath = path.join(baseDir, 'meta.json');
        metaSuccess = await downloadFile(cdnBase + 'meta.json', altManifestPath, true);
        if (metaSuccess) {
            try {
                const content = fs.readFileSync(altManifestPath, 'utf8');
                JSON.parse(content);
                console.log(`[INFO] Detected standard SOG model.`);
            } catch (e) {
                metaSuccess = false;
            }
        }
    }

    if (!metaSuccess) {
        console.log(`[ERROR] Could not find a valid JSON manifest at: ${cdnBase}`);
        rl.close();
        return;
    }

    const assetTypes = [
        'meta.json', 'means_l.webp', 'means_u.webp', 
        'quats.webp', 'scales.webp', 'sh0.webp', 
        'shN_centroids.webp', 'shN_labels.webp'
    ];

    const tasks = [];

    if (isStreamed) {
        const chunks = ['env'];
        for (let x = 0; x <= 30; x++) {
            for (let y = 0; y <= 80; y++) {
                chunks.push(`${x}_${y}`);
            }
        }
        for (const chunk of chunks) {
            for (const asset of assetTypes) {
                tasks.push({
                    url: cdnBase + `${chunk}/${asset}`,
                    dest: path.join(baseDir, `${chunk}/${asset}`)
                });
            }
        }
    } else {
        for (const asset of assetTypes) {
            tasks.push({
                url: cdnBase + asset,
                dest: path.join(baseDir, asset)
            });
        }
    }

    console.log(`[INFO] Downloading assets (${tasks.length} tasks)...`);
    let completed = 0;
    const batchSize = 60;

    for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);
        await Promise.all(batch.map(async t => {
            const success = await downloadFile(t.url, t.dest);
            if (success) completed++;
        }));
        process.stdout.write(`\rProcessed files: ${completed} / ${tasks.length}`);
    }

    console.log(`\n[INFO] Download complete! Success: ${completed} files.`);

    const outputPly = path.join(workDir, `model_${modelHash}_${modelVersionFolder}.ply`);
    console.log(`[INFO] Converting to PLY -> ${outputPly}`);

    try {
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const cmd = `${npxCmd} @playcanvas/splat-transform "${path.join(baseDir, manifestName)}" "${outputPly}"`;
        execSync(cmd, { stdio: 'inherit' });
        console.log(`\n[SUCCESS] Model successfully converted and saved as: model_${modelHash}_${modelVersionFolder}.ply`);
    } catch (err) {
        console.log(`\n[ERROR] Conversion failed: ${err.message}`);
    }

    rl.close();
}

main();