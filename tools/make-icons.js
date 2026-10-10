'use strict';
/* Render site/icons/icon.svg to the PNG sizes phones and browsers ask for.
   Uses headless Chrome, so no image library is needed:
     node tools/make-icons.js */
const fs = require('fs');
const path = require('path');
const { launch } = require('./drive.js');

const ICONS = path.join(__dirname, '..', 'site', 'icons');
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');

// Maskable icons get cropped to a circle or squircle by Android, so they need a
// full-bleed background and the artwork inside the central safe zone.
const maskable = svg
  .replace('rx="116"', 'rx="0"')
  .replace(/(<rect x="104"[\s\S]*<\/svg>)/, (m) => `<g transform="translate(51.2 51.2) scale(0.8)">${m.replace('</svg>', '')}</g></svg>`);

const OUTPUTS = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'apple-touch-icon.png', size: 180, src: maskable },   // iOS rounds the corners itself
  { file: 'maskable-512.png', size: 512, src: maskable },
];

(async () => {
  const s = await launch({ width: 512, height: 512 });
  try {
    await s.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const { file, size, src } of OUTPUTS) {
      await s.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      const html = `<html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
      await s.goto('data:text/html;base64,' + Buffer.from(html).toString('base64'));
      await s.waitFor('document.images[0] && document.images[0].complete');
      await s.screenshot(path.join(ICONS, file));
      console.log('wrote', file);
    }
  } finally {
    await s.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
