import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.static(__dirname));

const decodeHtml = (value) => value
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

function parseDuckDuckGoResults(html) {
  const results = [];
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    let url = match[1];
    const redirect = url.match(/[?&]uddg=([^&]+)/i);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (!/^https?:\/\//i.test(url)) continue;

    results.push({
      title: decodeHtml(match[2]),
      url,
      display_url: new URL(url).hostname.replace(/^www\./, ''),
      snippet: '',
      engine: 'duckduckgo',
      is_instant: false,
    });
    if (results.length === 20) break;
  }

  return results;
}

app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const engine = typeof req.query.engine === 'string' ? req.query.engine : 'duckduckgo';

  if (!query) {
    res.status(400).json({ success: false, error: 'Enter a search query.', results: [] });
    return;
  }

  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { 'user-agent': 'PotatoHomework/1.0 (+search client)' }, signal: AbortSignal.timeout(15000) },
    );
    const results = response.ok ? parseDuckDuckGoResults(await response.text()) : [];
    res.json({
      success: results.length > 0,
      query,
      engine,
      has_instant_answer: false,
      instant_answer: null,
      results,
      count: results.length,
    });
  } catch {
    res.status(502).json({ success: false, error: 'Search is temporarily unavailable.', results: [] });
  }
});

app.get('/api/proxy', async (req, res) => {
  const encodedUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!encodedUrl) {
    res.status(400).send('Missing URL');
    return;
  }

  let targetUrl;
  try {
    targetUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
  } catch {
    res.status(400).send('Invalid URL');
    return;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'user-agent': 'PotatoHomework/1.0 (+proxy client)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    res.status(response.status);
    const body = await response.text();
    const upstreamType = response.headers.get('content-type') || '';
    const isHtml = /<(?:!doctype|html|head|body)\b/i.test(body);
    res.set('Content-Type', isHtml ? 'text/html; charset=utf-8' : (upstreamType || 'text/plain; charset=utf-8'));
    res.send(body);
  } catch {
    res.status(502).send('The requested site could not be loaded.');
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'omnisearch-node' });
});

app.use(async (_req, res) => {
  res.type('html').send(await fs.readFile(path.join(__dirname, 'index.html'), 'utf8'));
});

app.listen(port, () => {
  console.log(`OmniSearch server listening on port ${port}`);
});