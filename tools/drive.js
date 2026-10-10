'use strict';
/* A small Chrome DevTools Protocol driver — enough to load the built page,
   run script in it, click things, and take screenshots.

   The Claude browser extension is not connected on this machine, and there is
   no puppeteer (no npm install here), but Chrome speaks CDP over a websocket
   and Node 24 ships both fetch and WebSocket. That is the whole dependency
   list. */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(opts) {
  opts = opts || {};
  if (!CHROME) throw new Error('drive: no Chrome or Edge binary found');

  const port = opts.port || 9333 + (process.pid % 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'society-events-cdp-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width || 1280},${opts.height || 900}`,
    'about:blank'
  ];
  if (opts.dark) args.push('--force-dark-mode', '--enable-features=WebContentsForceDark');

  const child = spawn(CHROME, args, { stdio: 'ignore' });

  /* Chrome writes the port file asynchronously; poll the HTTP endpoint. */
  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch { await sleep(100); }
  }
  if (!version) {
    child.kill();
    throw new Error('drive: Chrome did not open a debugging port');
  }

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((tgt) => tgt.type === 'page');
  if (!page) { child.kill(); throw new Error('drive: no page target'); }

  const session = await connect(page.webSocketDebuggerUrl);

  session.close = async () => {
    try { session.ws.close(); } catch { /* already gone */ }
    child.kill();
    await sleep(120);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
  };
  return session;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const events = new Map();
    let nextId = 1;

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: bad } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) bad(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
        else ok(msg.result);
      } else if (msg.method && events.has(msg.method)) {
        for (const fn of events.get(msg.method)) fn(msg.params);
      }
    });
    ws.addEventListener('error', reject);

    ws.addEventListener('open', () => {
      const send = (method, params) => new Promise((ok, bad) => {
        const id = nextId++;
        pending.set(id, { resolve: ok, reject: bad });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });

      const on = (method, fn) => {
        if (!events.has(method)) events.set(method, []);
        events.get(method).push(fn);
      };

      const once = (method, timeout) => new Promise((ok, bad) => {
        const timer = setTimeout(() => bad(new Error('drive: timed out waiting for ' + method)),
          timeout || 15000);
        on(method, (params) => { clearTimeout(timer); ok(params); });
      });

      resolve(buildApi({ ws, send, on, once }));
    });
  });
}

function buildApi(core) {
  const { send, on, once } = core;
  const api = { ...core, console: [], errors: [] };

  /* Everything the page logs, kept for assertions after the fact. */
  const ready = (async () => {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    on('Runtime.consoleAPICalled', (p) => {
      api.console.push({
        level: p.type,
        text: (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      });
    });
    on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      api.errors.push(d.exception?.description || d.text || 'exception');
    });
    on('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') api.errors.push(p.entry.text);
    });
  })();

  api.goto = async (url) => {
    await ready;
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
  };

  /* Evaluated with top-level await allowed and the result serialised. */
  api.eval = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('drive.eval: ' +
        (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  };

  api.waitFor = async (expression, timeout) => {
    const limit = Date.now() + (timeout || 10000);
    for (;;) {
      if (await api.eval(`return !!(${expression});`)) return true;
      if (Date.now() > limit) throw new Error('drive: waitFor timed out — ' + expression);
      await sleep(80);
    }
  };

  /* Clicks through the DOM rather than by coordinate: the app dispatches on
     data-act, so a synthetic click carries exactly the same information as a
     real one, and it survives layout changes. */
  api.click = async (selector) => {
    const hit = await api.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;`);
    if (!hit) throw new Error('drive: nothing matched ' + selector);
    await sleep(140);
    return true;
  };

  api.type = async (selector, value) => {
    await api.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true })); }`);
  };

  api.text = (selector) => api.eval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.innerText.trim() : null;`);

  api.screenshot = async (file, opts) => {
    opts = opts || {};
    const res = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: !!opts.full
    });
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    return file;
  };

  api.setViewport = (width, height, opts) => {
    opts = opts || {};
    return send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: opts.dpr || 2,
      mobile: !!opts.mobile
    });
  };

  api.setColorScheme = (scheme) =>
    send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

  return api;
}

module.exports = { launch, sleep, CHROME };
