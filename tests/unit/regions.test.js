// The tree every page hangs off.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, municipalityOf, straddleSiblings, focusFor, COUNTRY } from '../../site/js/lib/regions.js';

const tree = buildTree([
  { id: 'IS', parent: null, kind: 'country', name: 'Ísland' },
  { id: 'rvk', parent: 'IS', kind: 'sveitarfelag', name: 'Reykjavíkurborg' },
  { id: 'rvk-midborg', parent: 'rvk', kind: 'hverfi', name: 'Miðborg', code: 'midborg' },
  { id: 'rvk-arbaer', parent: 'rvk', kind: 'hverfi', name: 'Árbær', code: 'arbaer' },
  { id: 'thing', parent: 'IS', kind: 'sveitarfelag', name: 'Þingeyjarsveit' },
  { id: 'thing-660', parent: 'thing', kind: 'postnumer', name: '660 Mývatn', code: '660' },
  { id: 'thing-641', parent: 'thing', kind: 'postnumer', name: '641 Húsavík', code: '641' },
  { id: 'nord', parent: 'IS', kind: 'sveitarfelag', name: 'Norðurþing' },
  { id: 'nord-660', parent: 'nord', kind: 'postnumer', name: '660 Mývatn', code: '660' },
  { id: 'nord-640', parent: 'nord', kind: 'postnumer', name: '640 Húsavík', code: '640' },
  // A sveitarfélag covered by a single postal area.
  { id: 'sel', parent: 'IS', kind: 'sveitarfelag', name: 'Seltjarnarnesbær' },
  { id: 'sel-170', parent: 'sel', kind: 'postnumer', name: '170 Seltjarnarnes', code: '170' },
  { id: 'sea', parent: 'IS', kind: 'sea', name: 'Hafsvæði' }
]);

describe('the tree', () => {
  test('children and parents', () => {
    assert.deepEqual(tree.children('rvk').map(r => r.id), ['rvk-midborg', 'rvk-arbaer']);
    assert.equal(tree.parent('rvk-midborg').id, 'rvk');
    assert.equal(tree.parent(COUNTRY), null);
  });

  test('a single child is not a subdivision', () => {
    // The one area *is* the sveitarfélag. Offering it as a deeper level would
    // be a link from a page to itself under a different heading.
    assert.deepEqual(tree.children('sel'), []);
    assert.equal(tree.isLeaf('sel'), true);
    assert.equal(tree.isLeaf('rvk'), false);
  });

  test('the breadcrumb runs root first', () => {
    assert.deepEqual(tree.path('rvk-midborg').map(r => r.id), ['IS', 'rvk', 'rvk-midborg']);
    assert.deepEqual(tree.path('IS').map(r => r.id), ['IS']);
  });

  test('an unknown id is null, and its path is empty', () => {
    assert.equal(tree.get('nope'), null);
    assert.deepEqual(tree.path('nope'), []);
  });

  test('municipalityOf climbs from an area and stops at a sveitarfélag', () => {
    assert.equal(municipalityOf(tree, 'rvk-midborg'), 'rvk');
    assert.equal(municipalityOf(tree, 'rvk'), 'rvk');
    assert.equal(municipalityOf(tree, COUNTRY), null);
  });
});

describe('what the map is about', () => {
  test('a region with children shows its children', () => {
    const f = focusFor(tree, 'rvk');
    assert.deepEqual(f.ids, ['rvk-midborg', 'rvk-arbaer']);
    assert.equal(f.selected, null);
    assert.equal(f.fit, 'rvk');
  });

  test('the country shows the sveitarfélög', () => {
    assert.ok(focusFor(tree, COUNTRY).ids.includes('rvk'));
  });

  test('a leaf shows itself among its siblings', () => {
    // So there is always something next door to click.
    const f = focusFor(tree, 'rvk-midborg');
    assert.deepEqual(f.ids, ['rvk-midborg', 'rvk-arbaer']);
    assert.equal(f.selected, 'rvk-midborg');
  });

  test('an undivided sveitarfélag is a leaf among the other sveitarfélög', () => {
    const f = focusFor(tree, 'sel');
    assert.equal(f.selected, 'sel');
    assert.ok(f.ids.includes('rvk') && f.ids.includes('sel'));
  });

  test('an unknown region is an empty map, not a crash', () => {
    assert.deepEqual(focusFor(tree, 'nope'), { ids: [], selected: null, fit: null });
  });
});

describe('postal districts that cross a boundary', () => {
  test('660 Mývatn names its other halves', () => {
    // The district straddles two sveitarfélög and is cut to each, so the same
    // label is two regions. Each has to be able to point at the other.
    assert.deepEqual(straddleSiblings(tree, 'thing-660').map(r => r.id), ['nord-660']);
    assert.deepEqual(straddleSiblings(tree, 'nord-660').map(r => r.id), ['thing-660']);
  });

  test('a district inside one sveitarfélag has none', () => {
    assert.deepEqual(straddleSiblings(tree, 'thing-641'), []);
  });

  test('named neighbourhoods never straddle', () => {
    assert.deepEqual(straddleSiblings(tree, 'rvk-midborg'), []);
  });
});
