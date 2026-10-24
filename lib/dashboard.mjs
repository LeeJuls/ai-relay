import http from 'node:http';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient,readConfiguration } from './core.mjs';
import { deliveryStatus } from './receiver.mjs';
import { absoluteRoot, readJson } from './storage.mjs';
import { RelayError } from './errors.mjs';
import {list as slotList} from './slots.mjs';

function page(strings, nonce) {
  const labels = JSON.stringify(strings).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="${strings.LANGUAGE}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${strings.UI_TITLE}</title>
<style nonce="${nonce}">:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb}body{max-width:1000px;margin:6vh auto;padding:24px}h1{font-size:30px;margin-bottom:8px}p{color:#94a3b8;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin:32px 0}.card{border:1px solid #334155;border-radius:16px;background:#172033;padding:24px}.card h2{margin-top:0;color:#7dd3fc}.row{display:flex;justify-content:space-between;gap:20px;margin:12px 0}.warn{color:#fbbf24}footer{border-top:1px solid #334155;padding-top:20px;font-size:14px}#error{color:#fda4af}</style>
<h1>${strings.UI_TITLE}</h1><p>${strings.UI_SUBTITLE}</p><div id="cards" class="grid"></div><h2>${strings.UI_SLOTS}</h2><div id="slots" class="grid"></div><p id="error"></p><footer>${strings.UI_PRIVACY}</footer>
<script nonce="${nonce}">const s=${labels};const labels=[['phase','UI_PHASE'],['processAlive','UI_PROCESS'],['pending','UI_PENDING'],['accepted','UI_ACCEPTED'],['held','UI_HELD'],['sendOnly','UI_SEND_ONLY'],['oldestPendingAgeMs','UI_OLDEST_AGE']];
async function refresh(){try{const response=await fetch('/api/status');if(!response.ok)throw Error();const data=await response.json();const cards=document.getElementById('cards');cards.replaceChildren();for(const a of data.addresses){const card=document.createElement('section');card.className='card';const title=document.createElement('h2');title.textContent=a.address;card.append(title);for(const [key,label] of labels){const row=document.createElement('div');row.className='row';const name=document.createElement('span');name.textContent=s[label];const value=document.createElement('strong');value.textContent=key==='phase'?(s['PHASE_'+a[key]]||a[key]):key==='processAlive'?(a[key]?s.UI_ALIVE:s.UI_STOPPED):a[key];if(key==='held'&&a[key])value.className='warn';row.append(name,value);card.append(row)}if(a.experimental){const p=document.createElement('p');p.textContent=s.UI_EXPERIMENTAL;card.append(p)}cards.append(card)}const slots=document.getElementById('slots');slots.replaceChildren();for(const x of data.slots){const card=document.createElement('section');card.className='card';const title=document.createElement('h2');title.textContent=x.name;const summary=document.createElement('p');summary.textContent=s.UI_HOLDER+': '+(x.holder?.as||s.UI_FREE)+'; '+s.UI_QUEUE+': '+x.queue.map(q=>q.as).join(', ')+'; '+s.UI_HOLDER_AGE+': '+(x.holderAgeMs??0);card.append(title,summary);if(x.staleInferred){const warning=document.createElement('p');warning.className='warn';warning.textContent=s.UI_SLOT_STALE;card.append(warning)}slots.append(card)}document.getElementById('error').textContent=''}catch{document.getElementById('error').textContent=s.UI_ERROR}}
refresh();setInterval(refresh,2000);</script></html>`;
}

export async function openDashboard({ root, language = 'en', port = 0 }) {
  root = absoluteRoot(root);
  if (!['en', 'ko', 'ja'].includes(language) || !Number.isInteger(port) || port < 0 || port > 65535) throw new RelayError('INVALID_ARGS');
  const cfg = await readJson(root, ['config.json'], { corrupt: 'CORRUPT_CONFIG' });
  if (!cfg?.addresses || !Object.keys(cfg.addresses).length) throw new RelayError('NOT_INITIALIZED');
  for (const address of Object.keys(cfg.addresses)) await createClient({ root, address }).inbox();
  const strings = JSON.parse(await fs.readFile(new URL(`../locales/${language}.json`, import.meta.url), 'utf8'));
  const nonce = randomBytes(18).toString('base64');
  let url;
  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store'); response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    if (request.headers.host !== new URL(url).host || (request.headers.origin && request.headers.origin !== new URL(url).origin)) { response.writeHead(403).end(); return; }
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    try {
      if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page(strings, nonce)); }
      else if (request.url === '/api/status') {
        const addresses = [];
        const current=await readConfiguration({root});
        for (const address of Object.keys(current.addresses)) addresses.push(await deliveryStatus({ root, address }));
        response.setHeader('content-type', 'application/json; charset=utf-8'); response.end(JSON.stringify({ addresses, slots:await slotList({root}) }));
      } else response.writeHead(404).end();
    } catch { response.writeHead(503).end(JSON.stringify({ code: 'STATUS_UNAVAILABLE' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}/`;
  return { url, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}
