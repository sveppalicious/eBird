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
      readFileSync(join(SITE, 'data/mun/0000-reykjavikurborg/checklists.json'), 'utf8'));
    for (const o of chk.obsrs) {
      assert.match(o, /^obsr\d+$/, `observer field "${o}" is not an opaque id`);
    }
  });
});

describe('the site stays self-contained', () => {
  const jsFiles = () => walkFiles(join(SITE, 'js')).filter(p => p.endsWith('.js'));

  test('index.html loads only its own files', () => {
    // Relative paths are what let the site live at /eBird/ on Pages and move to
    // a custom domain later without a code change. An absolute path breaks the
    // subpath; a remote one breaks the offline property.
    const html = readFileSync(join(SITE, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = m[1];
      if (url.startsWith('#') || url.startsWith('data:')) continue;
      if (/^https?:\/\//.test(url)) {
        assert.match(url, /^https:\/\/ebird\.org\//,
          `index.html links out to ${url}`);
        continue;
      }
      assert.ok(!url.startsWith('/'), `absolute path ${url} breaks the /eBird/ subpath`);
    }
  });

  test('no build step and no bundler crept in', () => {
    for (const f of ['webpack.config.js', 'vite.config.js', 'rollup.config.js']) {
      assert.ok(!existsSync(join(ROOT, f)), `${f} appeared; the site is meant to be served as-is`);
    }
  });

  test('the only third-party network calls are the opt-in basemaps', () => {
    // A basemap is off by default, which is what keeps the site usable offline
    // and free of runtime third parties. Anything else fetching across the
    // network would take that away silently.
    const allowed = [/tile\.openstreetmap\.org/, /server\.arcgisonline\.com/,
                     /openstreetmap\.org\/copyright/, /www\.esri\.com/,
                     /ebird\.org/, /api\.ebird\.org/,
                     // Not a network call: the SVG namespace is an identifier,
                     // and createElementNS refuses to work without it.
                     /^http:\/\/www\.w3\.org\/2000\/svg$/];
    for (const f of jsFiles()) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        const url = m[0];
        assert.ok(allowed.some(re => re.test(url)),
          `${relative(ROOT, f)} references ${url}`);
      }
    }
  });

  test('the personal import never leaves the browser', () => {
    // There is no backend, and this file holds a complete history of where
    // somebody has been. Uploading it would be the single worst thing this
    // project could do, so the ways of doing it are named here rather than
    // trusted to review.
    const src = readFileSync(join(SITE, 'js/mydata.js'), 'utf8');
    for (const bad of ['XMLHttpRequest', 'WebSocket', 'sendBeacon', 'FormData',
                       'action=', 'method: \'POST\'', 'method: "POST"']) {
      assert.ok(!src.includes(bad), `mydata.js contains ${bad}`);
    }
  });

  test('mydata.js only ever fetches the site\'s own payloads', () => {
    // It does fetch -- the lookups that place a locality in a municipality --
    // and that is fine as long as every call is a same-origin GET of a relative
    // data/ path. An absolute URL here would be data leaving the machine.
    const src = readFileSync(join(SITE, 'js/mydata.js'), 'utf8');
    const calls = [...src.matchAll(/fetch\(\s*(['"`])(.*?)\1/g)].map(m => m[2]);
    assert.ok(calls.length > 0, 'expected the lookup fetches to still be here');
    for (const url of calls) {
      assert.match(url, /^data\//, `mydata.js fetches ${url}`);
    }
    // A second argument to fetch is where a method or body would go.
    assert.ok(!/fetch\(\s*(['"`]).*?\1\s*,/.test(src),
      'a fetch in mydata.js has options -- check for a method or body');
  });

  test('every .js under site/ parses as an ES module', () => {
    // Nothing compiles this code, so a typo in a module the router only loads
    // for one route can reach production. `node --check` parses without
    // executing, which is what lets it cover the DOM-coupled modules too.
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
