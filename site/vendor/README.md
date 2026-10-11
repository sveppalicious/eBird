# Vendored libraries

Copied in, not loaded from a CDN, so the site still makes no third-party
requests and works offline.

| library | version | file | licence |
|---|---|---|---|
| Leaflet | 1.9.4 | `leaflet/leaflet.js`, `leaflet/leaflet.css` | BSD-2-Clause |
| Preact + hooks + htm | preact 10 via htm 3.1.1 | `preact/standalone.module.js` | MIT / Apache-2.0 |

To update: `npm pack leaflet htm`, and copy `dist/leaflet.{js,css}`, `dist/images/`
and `htm/preact/standalone.module.js` over these.
