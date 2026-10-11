// Repo hygiene, and the privacy rules this project has run on from the start.
//
// site/ is published to the open web on every push to main. These are the
// checks that keep something from being published that should never leave this
// machine, and they run before anything else because a leak cannot be undone by
// a later commit -- the data is already out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SITE = join(ROOT, 'site');

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const tracked = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);

describe('nothing private is publishable', () => {
  test('no CSV anywhere under site/', () => {
    // Every CSV this project touches is either a personal eBird export -- a
    // complete history of where somebody has been and when -- or a slice of the
    // licensed EBD. Neither may sit in the directory that gets deployed.
    const csvs = walkFiles(SITE).filter(p => extname(p).toLowerCase() === '.csv');
    assert.deepEqual(csvs.map(p => relative(ROOT, p)), []);
  });

  test('no CSV is tracked by git at all', () => {
    assert.deepEqual(tracked().filter(f => f.toLowerCase().endsWith('.csv')), []);
  });

  test('no personal export or raw EBD is tracked', () => {
    const bad = tracked().filter(f =>
      /MyEBirdData/i.test(f) || /^ebd_IS/i.test(f) || f.startsWith('work/'));
    assert.deepEqual(bad, []);
  });

  test('.gitignore still covers the files that must never be committed', () => {
    // If someone trims this file, the tests above only catch it once the file
    // has already been staged. This catches the removal itself.
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    for (const pattern of ['MyEBirdData.csv', '*.csv', 'ebd_IS_unv_smp_*/', 'work/']) {
      assert.ok(ignore.includes(pattern), `.gitignore no longer lists ${pattern}`);
    }
  });

  test('no observer names in the published payloads', () => {
    // The EBD distributes opaque observer ids, not names, and the site links to
    // profiles by id. Anything looking like a display name in checklists.json
    // would mean a different source crept in.
    const chk = JSON.parse(
      readFileSync(join(SITE, 'data/region/0000-reykjavikurborg/checklists.json'), 'utf8'));
    for (const o of chk.obsrs) {
      assert.match(o, /^obsr\d+$/, `observer field "${o}" is not an opaque id`);
    }
  });
});

describe('the site stays self-contained', () => {
  // Our own code. The vendored libraries are checked separately: Leaflet's
  // source mentions its own homepage, which is a string, not a request.
  const jsFiles = () => walkFiles(join(SITE, 'js')).filter(p => p.endsWith('.js'));

  test('index.html loads only its own files', () => {
    // Relative paths are what let the site live at /eBird/ on Pages and move to
    // a custom domain later without a code change. An absolute path breaks the
    // subpath; a remote one breaks the offline property.
    const html = readFileSync(join(SITE, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = m[1];
      if (url.startsWith('#') || url.startsWith('data:')) continue;
      assert.ok(!/^https?:\/\//.test(url) && !url.startsWith('//'), `index.html loads ${url}`);
      assert.ok(!url.startsWith('/'), `absolute path ${url} breaks the /eBird/ subpath`);
    }
  });

  test('no build step and no bundler crept in', () => {
    for (const f of ['webpack.config.js', 'vite.config.js', 'rollup.config.js']) {
      assert.ok(!existsSync(join(ROOT, f)), `${f} appeared; the site is meant to be served as-is`);
    }
  });

  test('libraries are vendored, never loaded from a CDN', () => {
    for (const f of ['vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
                     'vendor/preact/standalone.module.js']) {
      assert.ok(existsSync(join(SITE, f)), `${f} is missing`);
    }
    // Every import in our code is a relative path into the repo.
    for (const f of jsFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        assert.ok(m[1].startsWith('./') || m[1].startsWith('../'),
          `${relative(ROOT, f)} imports ${m[1]}`);
      }
    }
  });

  test('our code names no host but ebird.org, and only ever as a link', () => {
    // There are no map tiles any more, so the rule is simple: the page requests
    // nothing from anyone else. The only URLs left are the links out to eBird.
    for (const f of jsFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/https?:\/\/[^\s'"`)<]+/g)) {
        assert.match(m[0], /^https:\/\/ebird\.org\//, `${relative(ROOT, f)} references ${m[0]}`);
      }
    }
  });

  test('the map draws no tiles', () => {
    // A tile layer is the one thing that would quietly reintroduce third-party
    // requests, and the flash the old map had.
    const src = readFileSync(join(SITE, 'js/ui/RegionMap.js'), 'utf8');
    assert.ok(!/tileLayer\s*\(/.test(src), 'RegionMap.js creates a tile layer');
  });

  test('the personal table never leaves the browser', () => {
    // There is no backend, and this is a complete history of where somebody
    // has been. Uploading it would be the single worst thing this project could
    // do, so the ways of doing it are named here rather than trusted to review.
    // personal.js is pure computation and mine.js is IndexedDB: neither has
    // any business touching the network at all.
    for (const f of ['js/lib/personal.js', 'js/data/mine.js', 'js/lib/csv.js']) {
      const src = readFileSync(join(SITE, f), 'utf8')
        .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');     // comments may name them
      for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'FormData',
                         'EventSource', 'importScripts']) {
        assert.ok(!src.includes(bad), `${f} contains ${bad}`);
      }
    }
  });

  test('the upload page reads the file and fetches only our own lookups', () => {
    const page = readFileSync(join(SITE, 'js/ui/MyDataPage.js'), 'utf8');
    assert.ok(!page.includes('fetch('), 'MyDataPage.js fetches directly');
    for (const bad of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'FormData']) {
      assert.ok(!page.includes(bad), `MyDataPage.js contains ${bad}`);
    }
    // The one fetch in the data layer is a GET of a relative data/ path.
    const remote = readFileSync(join(SITE, 'js/data/remote.js'), 'utf8');
    const calls = [...remote.matchAll(/fetch\(([^)]*)\)/g)].map(m => m[1]);
    assert.equal(calls.length, 1, 'expected exactly one fetch in remote.js');
    assert.ok(calls[0].includes('${BASE}/'), `fetch target is ${calls[0]}`);
    assert.ok(!calls[0].includes(','), 'a fetch with options -- check for a method or body');
    assert.match(remote, /const BASE = 'data';/);
  });

  test('the pure library stays pure', () => {
    // lib/ is what the unit tests run under node, and what could one day run in
    // a worker. One stray `document` and neither is true.
    for (const f of walkFiles(join(SITE, 'js/lib')).filter(p => p.endsWith('.js'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const bad of ['document.', 'window.', 'localStorage', 'indexedDB', 'fetch(']) {
        assert.ok(!src.includes(bad), `${relative(ROOT, f)} uses ${bad}`);
      }
    }
  });

  test('every .js under site/js parses as an ES module', () => {
    // Nothing compiles this code, so a typo in a module only one route loads
    // can reach production. `node --check` parses without executing.
    for (const f of jsFiles()) {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      } catch (e) {
        assert.fail(`${relative(ROOT, f)} does not parse:\n${e.stderr}`);
      }
    }
  });
});

describe('the deploy is wired up', () => {
  test('site/.nojekyll exists', () => {
    // Without it Pages runs the content through Jekyll.
    assert.ok(existsSync(join(SITE, '.nojekyll')));
  });

  test('the Pages workflow publishes site/, not the repo root', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /path:\s*site\s*$/m,
      'the workflow must upload site/ -- the root contains the EBD and R sources');
  });

  test('every payload the site fetches actually parses', () => {
    // A truncated write leaves valid-looking JSON on disk that fails at runtime
    // in whichever view happens to need it.
    for (const f of walkFiles(join(SITE, 'data')).filter(p => p.endsWith('.json'))) {
      try {
        JSON.parse(readFileSync(f, 'utf8'));
      } catch (e) {
        assert.fail(`${relative(ROOT, f)} is not valid JSON: ${e.message}`);
      }
    }
  });
});
