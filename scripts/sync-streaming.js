#!/usr/bin/env node

/**
 * sync-streaming.js
 *
 * Scrapes radios.com.br for streaming URLs and syncs them with the database.
 * Runs daily via cron at 23:00 BRT (02:00 UTC).
 *
 * Phase 1: Scrape all stations from radios.com.br API + individual pages
 * Phase 2: Match against DB broadcasters and update new/changed streaming URLs
 *
 * Usage: node scripts/sync-streaming.js
 * Cron:  0 2 * * * cd /path/to/signalads-backend && node scripts/sync-streaming.js >> logs/streaming-sync.log 2>&1
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load .env from backend root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI;
const DATA_DIR = path.join(__dirname, '../data/streaming');
const CSV_FILE = path.join(DATA_DIR, 'radios_brasil.csv');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const DELAY_MIN = 800;
const DELAY_MAX = 1500;

// ─── Utilities ───

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
}

function randomDelay() {
  return DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
}

function curlGet(url) {
  try {
    return execFileSync('curl', [
      '-s', '-L', '--max-time', '20',
      '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml',
      '-H', 'Referer: https://www.radios.com.br/',
      url
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 25000 });
  } catch {
    return null;
  }
}

function curlPost(url, data) {
  return execFileSync('curl', [
    '-s', '-L', '--max-time', '60',
    '-X', 'POST',
    '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'Referer: https://www.radios.com.br/estatistica/am-fm/',
    '-H', 'X-Requested-With: XMLHttpRequest',
    '-d', data,
    url
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
}

// ─── Scraper ───

function parseName(text) {
  const dialMatch = text.match(/(\d{2,4}[.,]\d\s*(FM|AM)?(\s+\d{2,4}[.,]\d\s*(FM|AM)?)?)/i);
  const dial = dialMatch ? dialMatch[0].trim() : '';
  return { name: text, dial };
}

function parseLocation(text) {
  const parts = text.split('/').map(s => s.trim());
  return { city: parts[0] || '', uf: parts[1] || '' };
}

function getStreamUrl(pageUrl, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const html = curlGet(pageUrl);
    if (!html || html.length < 500) {
      if (i < retries - 1) sleepSync(2000 * (i + 1));
      continue;
    }
    const match = html.match(/sourcesFlowPlayer\s*=\s*\[[\s\S]*?src\s*:\s*["']([^"']+)["']/);
    return match ? match[1] : null;
  }
  return null;
}

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch {}
  return { lastIndex: -1, total: 0, withStream: 0, date: '' };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

function appendCsv(row) {
  const escaped = row.map(field => `"${String(field).replace(/"/g, '""')}"`);
  fs.appendFileSync(CSV_FILE, escaped.join(',') + '\n');
}

async function scrape() {
  log('=== FASE 1: SCRAPING radios.com.br ===');

  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Check if today's scrape is already complete
  const progress = loadProgress();
  const today = new Date().toISOString().substring(0, 10);

  if (progress.date === today && progress.lastIndex >= progress.total - 1 && progress.total > 0) {
    log(`Scrape de hoje (${today}) ja concluido. Pulando para importacao.`);
    return true;
  }

  // If date changed, start fresh
  if (progress.date !== today) {
    log('Iniciando scrape novo...');
    progress.lastIndex = -1;
    progress.withStream = 0;
    progress.date = today;

    // Reset CSV
    fs.writeFileSync(CSV_FILE, '');
    appendCsv(['Nome da Emissora', 'Dial', 'Cidade', 'UF', 'Link do Streaming', 'Ranking', 'Visitas']);
  }

  // Get current year/month for API
  const now = new Date();
  // Use previous month to ensure data is available
  const targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ano = targetDate.getFullYear();
  const mes = targetDate.getMonth() + 1;

  // Fetch station list via API
  log(`Buscando lista via API (${ano}/${mes})...`);
  const pageHtml = curlGet(`https://www.radios.com.br/estatistica/am-fm/${ano}/${mes}?pais=33`);
  if (!pageHtml) {
    log('ERRO: Nao conseguiu acessar pagina de estatisticas');
    return false;
  }

  const timeMatch = pageHtml.match(/time:\s*'(\d+)'/);
  const tokenMatch = pageHtml.match(/t:"([a-f0-9]+)"/);
  const time = timeMatch ? timeMatch[1] : '';
  const token = tokenMatch ? tokenMatch[1] : '';

  if (!time || !token) {
    log('ERRO: Nao encontrou token/time na pagina');
    return false;
  }

  const postData = `modulacao=am-fm&ano=${ano}&mes=${mes}&pais=33&uf=0&regiao=0&segmento=0&time=${time}&t=${token}`;
  const result = curlPost('https://www.radios.com.br/ajax/estatistica/relatorio', postData);

  let radios;
  try {
    radios = JSON.parse(result).data;
  } catch {
    log('ERRO: Resposta da API invalida');
    return false;
  }

  log(`Total: ${radios.length} emissoras`);
  progress.total = radios.length;

  // Visit each station page
  const startIndex = progress.lastIndex + 1;
  let withStream = progress.withStream;

  if (startIndex > 0) log(`Retomando do index ${startIndex}...`);

  for (let i = startIndex; i < radios.length; i++) {
    const r = radios[i];
    const { name, dial } = parseName(r.radio.text);
    const { city, uf } = parseLocation(r.localizacao);

    sleepSync(randomDelay());
    const streamUrl = getStreamUrl(r.radio.url);

    if (streamUrl) {
      withStream++;
      appendCsv([name, dial, city, uf, streamUrl, r.ranking, r.visitas]);
    } else {
      appendCsv([name, dial, city, uf, 'SEM STREAM', r.ranking, r.visitas]);
    }

    if (i % 100 === 0) {
      log(`Progresso: ${i + 1}/${radios.length} (${withStream} com stream)`);
    }

    // Save progress every 10
    if (i % 10 === 0) {
      progress.lastIndex = i;
      progress.withStream = withStream;
      saveProgress(progress);
    }
  }

  // Final save
  progress.lastIndex = radios.length - 1;
  progress.withStream = withStream;
  saveProgress(progress);

  log(`Scrape concluido: ${radios.length} emissoras, ${withStream} com stream`);
  return true;
}

// ─── Importer ───

function normalizeName(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^radio\s+/i, '')
    .replace(/\d{2,4}[.,]\d\s*(fm|am)?/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeFreq(str) {
  const match = (str || '').match(/(\d{2,4}[.,]\d)/);
  return match ? match[1].replace(',', '.') : '';
}

function normalizeCity(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function makeKey(name, dial, city) {
  return `${normalizeName(name)}|${normalizeFreq(dial)}|${normalizeCity(city)}`;
}
function makeFreqCityKey(dial, city) {
  return `${normalizeFreq(dial)}|${normalizeCity(city)}`;
}
function makeNameCityKey(name, city) {
  return `${normalizeName(name)}|${normalizeCity(city)}`;
}

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const matches = lines[i].match(/"([^"]*(?:""[^"]*)*)"/g);
    if (!matches || matches.length < 5) continue;
    const fields = matches.map(m => m.slice(1, -1).replace(/""/g, '"'));
    rows.push({
      name: fields[0],
      dial: fields[1],
      city: fields[2],
      uf: fields[3],
      streamUrl: fields[4],
    });
  }
  return rows;
}

async function importStreaming() {
  log('=== FASE 2: IMPORTACAO PARA O BANCO ===');

  if (!MONGO_URI) {
    log('ERRO: MONGODB_URI nao definida no .env');
    return;
  }

  if (!fs.existsSync(CSV_FILE)) {
    log('ERRO: CSV nao encontrado');
    return;
  }

  await mongoose.connect(MONGO_URI, { dbName: 'test' });
  log('Conectado ao MongoDB');

  const db = mongoose.connection.db;

  // Get ALL broadcasters
  const dbBroadcasters = await db.collection('users').find({
    userType: 'broadcaster',
  }).toArray();

  log(`DB: ${dbBroadcasters.length} emissoras total`);

  // Parse CSV
  const csvRows = parseCSV(CSV_FILE);
  const csvWithStream = csvRows.filter(r => r.streamUrl !== 'SEM STREAM');
  log(`CSV: ${csvWithStream.length} emissoras com streaming URL`);

  // Build lookups
  const csvByKey = new Map();
  csvWithStream.forEach(r => {
    const key = makeKey(r.name, r.dial, r.city);
    if (!csvByKey.has(key)) csvByKey.set(key, r);
  });

  const csvByFreqCity = new Map();
  const freqCityDupes = new Set();
  csvWithStream.forEach(r => {
    const freq = normalizeFreq(r.dial);
    if (!freq) return;
    const key = makeFreqCityKey(r.dial, r.city);
    if (freqCityDupes.has(key)) return;
    if (csvByFreqCity.has(key)) {
      freqCityDupes.add(key);
      csvByFreqCity.delete(key);
    } else {
      csvByFreqCity.set(key, r);
    }
  });

  const csvByNameCity = new Map();
  const nameCityDupes = new Set();
  csvWithStream.forEach(r => {
    const name = normalizeName(r.name);
    if (!name) return;
    const key = makeNameCityKey(r.name, r.city);
    if (nameCityDupes.has(key)) return;
    if (csvByNameCity.has(key)) {
      nameCityDupes.add(key);
      csvByNameCity.delete(key);
    } else {
      csvByNameCity.set(key, r);
    }
  });

  // Match all broadcasters
  let newUrls = 0, updatedUrls = 0, unchanged = 0, noMatch = 0;
  const updates = [];

  for (const b of dbBroadcasters) {
    const gi = b.broadcasterProfile?.generalInfo || {};
    const city = b.address?.city || '';
    const currentUrl = b.broadcasterProfile?.coverage?.streamingUrl || '';

    // Try matching (same 3 fallbacks)
    let csvMatch = csvByKey.get(makeKey(gi.stationName, gi.dialFrequency, city));

    if (!csvMatch) {
      const freq = normalizeFreq(gi.dialFrequency);
      if (freq) csvMatch = csvByFreqCity.get(makeFreqCityKey(gi.dialFrequency, city));
    }

    if (!csvMatch) {
      const name = normalizeName(gi.stationName);
      if (name) csvMatch = csvByNameCity.get(makeNameCityKey(gi.stationName, city));
    }

    if (!csvMatch) {
      noMatch++;
      continue;
    }

    // Compare with current URL
    if (currentUrl === csvMatch.streamUrl) {
      unchanged++;
    } else if (!currentUrl) {
      newUrls++;
      updates.push({ id: b._id, streamUrl: csvMatch.streamUrl });
    } else {
      updatedUrls++;
      updates.push({ id: b._id, streamUrl: csvMatch.streamUrl });
    }
  }

  log(`Resultado: ${newUrls} novos, ${updatedUrls} alterados, ${unchanged} iguais, ${noMatch} sem match`);

  // Apply updates
  if (updates.length > 0) {
    log(`Aplicando ${updates.length} updates...`);
    let ok = 0;
    for (const u of updates) {
      await db.collection('users').updateOne(
        { _id: u.id },
        { $set: { 'broadcasterProfile.coverage.streamingUrl': u.streamUrl } }
      );
      ok++;
      if (ok % 100 === 0) log(`  ${ok}/${updates.length}`);
    }
    log(`${ok} emissoras atualizadas`);
  } else {
    log('Nenhum update necessario');
  }

  await mongoose.disconnect();
}

// ─── Main ───

async function main() {
  log('========================================');
  log('Sync Streaming URLs - Inicio');
  log('========================================');

  const scrapeOk = await scrape();

  if (scrapeOk) {
    await importStreaming();
  } else {
    log('Scrape falhou, importacao cancelada');
  }

  log('========================================');
  log('Sync Streaming URLs - Fim');
  log('========================================');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
