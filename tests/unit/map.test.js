// Web Mercator arithmetic. Nothing here touches the DOM.
//
// This matters more than it looks: the basemap has no library behind it. Tiles
// are placed by assuming a tile (x, y, z) occupies exactly WORLD/2^z units at
// WORLD*x/2^z. If `project` drifts from the standard, the imagery slides out
// from under the coastline and there is no third-party code to blame.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { project, pad, rampColor, WORLD } from '../../site/js/map.js';

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

describe('Web Mercator projection', () => {
  test('null island sits at the centre of the world square', () => {
    const [x, y] = project([0, 0]);
    near(x, WORLD / 2);
    near(y, WORLD / 2);
  });

  test('the antimeridian and the date line bound the square', () => {
    near(project([-180, 0])[0], 0);
    near(project([180, 0])[0], WORLD);
  });

  test('longitude is linear, latitude is not', () => {
    // The whole point of Mercator. An equirectangular projection would make
    // both linear and the tiles would not line up.
    const [x90] = project([90, 0]);
    near(x90, WORLD * 0.75);

    const y30 = project([0, 30])[1];
    const y60 = project([0, 60])[1];
    const mid = WORLD / 2;
    assert.ok((mid - y60) > 2 * (mid - y30),
      'high latitudes must stretch, or Iceland is drawn too short');
  });

  test('Reykjavík lands where the tile grid says it should', () => {
    // Cross-checked against the standard slippy-tile formula at z=7:
    // x = 2^7 * (lon+180)/360, y = 2^7 * (1 - ln(tan φ + sec φ)/π) / 2
    const [lon, lat] = [-21.94, 64.145];
    const [x, y] = project([lon, lat]);
    const z = 7, n = 2 ** z;

    const tileX = n * (lon + 180) / 360;
    const phi = lat * Math.PI / 180;
    const tileY = n * (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;

    near(x / (WORLD / n), tileX, 1e-9);
    near(y / (WORLD / n), tileY, 1e-9);
  });

  test('northward means upward, everywhere in Iceland', () => {
    // y grows downward in SVG, so a more northerly point must have a smaller y.
    const south = project([-19, 63.4])[1];   // Vestmannaeyjar
    const north = project([-19, 66.5])[1];   // Grímsey
    assert.ok(north < south);
  });

  test('the poles are clamped instead of returning Infinity', () => {
    // Mercator is undefined at ±90. A NaN here would silently blank the map.
    for (const lat of [90, -90, 89.999, -89.999]) {
      const [, y] = project([0, lat]);
      assert.ok(Number.isFinite(y), `latitude ${lat} produced ${y}`);
    }
  });

  test('all of Iceland stays inside the world square', () => {
    for (const lon of [-25, -13]) {
      for (const lat of [63, 67]) {
        const [x, y] = project([lon, lat]);
        assert.ok(x > 0 && x < WORLD, `x ${x} out of range`);
        assert.ok(y > 0 && y < WORLD, `y ${y} out of range`);
      }
    }
  });
});

describe('viewBox padding', () => {
  test('grows the box by the given factor about its centre', () => {
    const [x, y, w, h] = pad([0, 0, 10, 10], 2);
    near(w, 20);
    near(h, 20);
    near(x + w / 2, 5);
    near(y + h / 2, 5);
  });

  test('keeps the shape of the content', () => {
    // Regression: an earlier version forced the viewBox to the element aspect
    // and cropped, which left every zoomed municipality off centre.
    const box = [0, 0, 40, 10];                 // long and thin
    const [x, y, w, h] = pad(box, 1);
    near(w / h, 4);
    near(x + w / 2, 20);
    near(y + h / 2, 5);
  });

  test('honours a minimum width for a tiny municipality', () => {
    // Seltjarnarnesbær is 2.1 km²; framed on its own bounds there is no context
    // left to navigate by.
    const [, , w] = pad([0, 0, 0.001, 0.001], 1, 5);
    assert.ok(w >= 5);
  });

  test('never returns a zero or negative extent', () => {
    const [, , w, h] = pad([3, 3, 3, 3], 1.04, 0.1);
    assert.ok(w > 0 && h > 0);
  });
});

describe('colour ramp', () => {
  test('ends are the ends, and everything is a hex colour', () => {
    assert.match(rampColor(0), /^#[0-9a-f]{6}$/);
    assert.match(rampColor(1), /^#[0-9a-f]{6}$/);
    assert.match(rampColor(0.5), /^#[0-9a-f]{6}$/);
  });

  test('out-of-range input does not produce NaN', () => {
    // values/max can exceed 1 for a moment while a filtered view redraws.
    for (const t of [-1, 0, 1, 2, NaN]) {
      assert.match(rampColor(t), /^#[0-9a-f]{6}$/, `t=${t}`);
    }
  });

  test('gets darker as the count rises', () => {
    const lum = hex => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) +
                       parseInt(hex.slice(5, 7), 16);
    assert.ok(lum(rampColor(0.05)) > lum(rampColor(0.95)));
  });
});
