// Both languages, held to the same standard.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRINGS, makeT } from '../../site/js/i18n.js';

const JS = fileURLToPath(new URL('../../site/js/', import.meta.url));
function sources(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (f.endsWith('.js') && f !== 'i18n.js') out.push(readFileSync(p, 'utf8'));
  }
  return out;
}
const code = sources(JS).join('\n');
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('the dictionaries', () => {
  test('every key exists in both languages', () => {
    const is = Object.keys(STRINGS.is), en = Object.keys(STRINGS.en);
    assert.deepEqual(is.filter(k => !(k in STRINGS.en)), [], 'only in Icelandic');
    assert.deepEqual(en.filter(k => !(k in STRINGS.is)), [], 'only in English');
  });

  test('both languages take the same placeholders', () => {
    // A {n} missing from one language prints the template, braces and all.
    for (const k of Object.keys(STRINGS.en)) {
      assert.deepEqual(placeholders(STRINGS.is[k]), placeholders(STRINGS.en[k]), k);
    }
  });

  test('nothing is left untranslated by accident', () => {
    // Identical text in both languages is almost always a string that was
    // copied and never translated. The exceptions are spelled out.
    const same = new Set(['pager.of']);
    for (const k of Object.keys(STRINGS.en)) {
      if (same.has(k)) continue;
      assert.notEqual(STRINGS.is[k], STRINGS.en[k], `${k} is the same in both languages`);
    }
  });

  test('every key the code asks for is defined', () => {
    // A whole literal only -- 'kind.' + r.kind is a prefix, checked below.
    const used = new Set([...code.matchAll(/\bt\(\s*'([^']+)'\s*[,)]/g)].map(m => m[1]));
    // Keys chosen at runtime: one branch of a ternary inside t(...).
    for (const m of code.matchAll(/\bt\([^)]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { used.add(m[1]); used.add(m[2]); }
    assert.ok(used.size > 100, `only found ${used.size} keys -- the scan is broken`);
    const missing = [...used].filter(k => !(k in STRINGS.en)).sort();
    assert.deepEqual(missing, []);
  });

  test('every kind of region and every import error has its words', () => {
    // These keys are built from data, so the scan above cannot see them.
    for (const kind of ['country', 'sveitarfelag', 'hverfi', 'postnumer', 'sea']) {
      assert.ok(`kind.${kind}` in STRINGS.en, `kind.${kind}`);
    }
    for (const err of ['empty', 'column', 'no-iceland']) {
      assert.ok(`import.err.${err}` in STRINGS.en, `import.err.${err}`);
    }
  });

  test('no key is defined and never used', () => {
    const dynamic = k => k.startsWith('kind.') || k.startsWith('import.err.');
    const unused = Object.keys(STRINGS.en).filter(k => !dynamic(k) && !code.includes(`'${k}'`));
    assert.deepEqual(unused, []);
  });
});

describe('Icelandic place names are never declined by a template', () => {
  test('a name never follows a preposition', () => {
    // "í {name}" needs the dative of whatever is dropped in, and a template
    // cannot decline: "í Reykjavíkurborg" works, "í Akureyrarbær" is wrong.
    // Names therefore only stand in the nominative, after a colon or in
    // apposition ("á svæðinu {region}").
    const nameVars = /\b(í|á|úr|frá|til|innan|utan|við|um|að|af|hjá|með)\s+\{(name|region|here)\}/i;
    for (const [k, s] of Object.entries(STRINGS.is)) {
      assert.ok(!nameVars.test(s), `${k}: "${s}"`);
    }
  });
});

describe('the translator', () => {
  test('fills placeholders', () => {
    assert.equal(makeT('en')('pager.of', { a: 1, b: 100, n: 412 }), '1–100 of 412');
    assert.equal(makeT('is')('pager.of', { a: 1, b: 100, n: 412 }), '1–100 af 412');
  });

  test('a missing key shows as itself rather than crashing the page', () => {
    assert.equal(makeT('is')('no.such.key'), 'no.such.key');
  });

  test('an unknown language falls back to English', () => {
    assert.equal(makeT('xx')('tab.species'), 'Species');
  });

  test('a placeholder with no value is left visible, not printed as "undefined"', () => {
    assert.equal(makeT('en')('stat.since', {}), 'since {d}');
  });
});
