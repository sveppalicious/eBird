// Pure formatting and link building. These functions are what every table cell
// and every outbound link is made of, and several of them have been wrong in
// ways that were invisible on screen -- see the separator test below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  fmtDate, fmtDayMonth, fmtNum, fmtCount, fmtDuration, fmtPct, isoToDay, dayYear, dayMonth,
  dayOfYear, ebird, spName, spSecondary, fold, MONTHS
} from '../../site/js/lib/format.js';

describe('dates', () => {
  test('day 0 is 1 Jan 1970 in both languages', () => {
    assert.equal(fmtDate(0, 'en'), '1 Jan 1970');
    assert.equal(fmtDate(0, 'is'), '1 jan 1970');
  });

  test('the EBD cut-off renders as 30 June 2026', () => {
    // 20634 is meta.dateRange[1]; the whole "how current is this" notice hangs
    // off this one conversion.
    assert.equal(fmtDate(20634, 'en'), '30 Jun 2026');
  });

  test('formats in UTC, not the runner local time', () => {
    // A local-time formatter shifts the date by one either side of midnight,
    // which would silently move records between days for anyone west of UTC.
    assert.equal(fmtDate(19723, 'en'), '1 Jan 2024');
  });

  test('empty for null and undefined rather than "Invalid Date"', () => {
    assert.equal(fmtDate(null, 'en'), '');
    assert.equal(fmtDate(undefined, 'en'), '');
  });

  test('isoToDay inverts fmtDate for the personal export', () => {
    // Personal rows carry "YYYY-MM-DD"; the site's own rows carry day numbers.
    // Both have to land on the same day or a life list disagrees with itself.
    assert.equal(isoToDay('1970-01-01'), 0);
    assert.equal(isoToDay('2026-06-30'), 20634);
    assert.equal(fmtDate(isoToDay('2019-04-26'), 'en'), '26 Apr 2019');
  });

  test('dayYear and dayMonth agree with the formatted string', () => {
    assert.equal(dayYear(20634), 2026);
    assert.equal(dayMonth(20634), 5);          // zero-based: June
    assert.equal(MONTHS.en[dayMonth(20634)], 'Jun');
    assert.equal(MONTHS.is[dayMonth(20634)], 'jún');
  });
});

describe('numbers', () => {
  test('thousands separator is a visible dot', () => {
    // Regression: the first implementation produced U+202F NARROW NO-BREAK
    // SPACE, so "1 641 940" rendered as "1641940" in most fonts. Assert on the
    // code point, not on how it looks.
    assert.equal(fmtNum(1641940), '1.641.940');
    assert.ok(!fmtNum(1641940).includes(' '));
    assert.ok(!fmtNum(1641940).includes(' '));
  });

  test('small numbers are left alone', () => {
    assert.equal(fmtNum(0), '0');
    assert.equal(fmtNum(999), '999');
    assert.equal(fmtNum(1000), '1.000');
  });

  test('fmtCount writes eBird\'s X for an uncounted presence', () => {
    // The EBD stores "X" for present-but-not-counted; we keep it as null and
    // must not render it as 0, which would be a claim nobody made.
    assert.equal(fmtCount(null), 'X');
    assert.equal(fmtCount(undefined), 'X');
    assert.equal(fmtCount(0), '0');
    assert.equal(fmtCount(1200), '1.200');
  });

  test('fmtDuration is blank when unknown, not "0 min"', () => {
    assert.equal(fmtDuration(null), '');
    assert.equal(fmtDuration(undefined), '');
  });
});

describe('links back to eBird', () => {
  test('checklist and region links', () => {
    assert.equal(ebird.checklist('S12345678'),
      'https://ebird.org/checklist/S12345678');
    assert.equal(ebird.region('IS-1'), 'https://ebird.org/region/IS-1');
  });

  test('only hotspots get a location link', () => {
    // Personal locations have no public page. Linking them would 404, and
    // worse, would expose that a private location exists.
    assert.equal(ebird.hotspot('L123', 'H'), 'https://ebird.org/hotspot/L123');
    assert.equal(ebird.hotspot('L123', 'P'), null);
    assert.equal(ebird.hotspot('L123', undefined), null);
  });

  test('observer profile is base64 of the numeric part of the id', () => {
    // obsr113578 -> MTEzNTc4, checked against a profile link a user pasted into
    // a checklist comment in this dataset.
    assert.equal(ebird.observer('obsr113578'),
      'https://ebird.org/profile/MTEzNTc4/world');
  });

  test('7-digit observer ids keep their base64 padding', () => {
    // 86k checklists here have a 7-digit id, which encodes with a trailing "=".
    // Whether eBird wants it kept is unconfirmed; standard base64 keeps it, so
    // this pins current behaviour and will fail loudly if the flag is flipped.
    assert.equal(ebird.STRIP_BASE64_PADDING, false);
    assert.match(ebird.observer('obsr1000095'), /\/profile\/MTAwMDA5NQ==\/world$/);
  });

  test('species links scope to a region, defaulting to Iceland', () => {
    // A sveitarfélag is not an eBird region, so the closest scope is the parent.
    assert.equal(ebird.species('arcter', 'IS-1'),
      'https://ebird.org/species/arcter/IS-1');
    assert.equal(ebird.species('arcter'), 'https://ebird.org/species/arcter/IS');
  });
});

describe('species names', () => {
  const kria = { is: 'Kría', en: 'Arctic Tern', sci: 'Sterna paradisaea', hasIs: true };
  const noIs = { is: '', en: 'Bar-tailed Godwit', sci: 'Limosa lapponica', hasIs: false };

  test('Icelandic primary, English secondary', () => {
    assert.equal(spName(kria, 'is'), 'Kría');
    assert.equal(spSecondary(kria, 'is'), 'Arctic Tern');
  });

  test('English primary, scientific secondary', () => {
    assert.equal(spName(kria, 'en'), 'Arctic Tern');
    assert.equal(spSecondary(kria, 'en'), 'Sterna paradisaea');
  });

  test('falls back to English where eBird has no Icelandic name', () => {
    // Otherwise the row renders blank and the species looks missing.
    assert.equal(spName(noIs, 'is'), 'Bar-tailed Godwit');
    assert.notEqual(spName(noIs, 'is'), '');
  });

  test('an unknown taxon never renders as undefined', () => {
    assert.equal(typeof spName(undefined, 'is'), 'string');
    assert.equal(typeof spSecondary(undefined, 'is'), 'string');
  });
});

describe('day of year', () => {
  test('1 January is day 1 in every year, leap or not', () => {
    // Arrival dates are compared across years on this axis; an off-by-one in
    // leap years would shift every date after February.
    assert.equal(dayOfYear(isoToDay('2023-01-01')), 1);
    assert.equal(dayOfYear(isoToDay('2024-01-01')), 1);
    assert.equal(dayOfYear(isoToDay('2023-12-31')), 365);
    assert.equal(dayOfYear(isoToDay('2024-12-31')), 366);
  });

  test('fmtDayMonth drops the year', () => {
    assert.equal(fmtDayMonth(isoToDay('2025-04-19'), 'en'), '19 Apr');
    assert.equal(fmtDayMonth(isoToDay('2025-04-19'), 'is'), '19 apr');
  });
});

describe('percentages', () => {
  test('whole numbers above one percent', () => {
    assert.equal(fmtPct(0.243), '24%');
    assert.equal(fmtPct(1), '100%');
  });

  test('a rare bird is not rounded down to "0%"', () => {
    // Forty checklists out of 160,000 is not "never". Showing 0% for a species
    // the table then lists records of would be a contradiction on one row.
    assert.equal(fmtPct(0.004), '0,4%');
    assert.equal(fmtPct(0.0002), '<0,1%');
    assert.equal(fmtPct(0), '0%');
  });

  test('nothing to divide by renders as nothing, not NaN%', () => {
    assert.equal(fmtPct(null), '');
    assert.equal(fmtPct(NaN), '');
    assert.equal(fmtPct(Infinity), '');
  });
});

describe('search folding', () => {
  test('accents are optional', () => {
    assert.equal(fold('Kría'), 'kria');
    assert.ok(fold('Skógarþröstur').includes('skogarthrostur'));
  });

  test('þ, ð and æ are letters, and fold to what people type', () => {
    // These are not accented forms of anything, so Unicode normalisation alone
    // leaves them untouched and "thing" would never find Þingeyjarsveit.
    assert.equal(fold('Þingeyjarsveit'), 'thingeyjarsveit');
    assert.equal(fold('Garðabær'), 'gardabaer');
  });
});
