// The RFC4180 reader that a user's own eBird export goes through.
//
// This parser has already been the cause of the worst bug in the project: it
// discarded 98% of a real export because eBird drops trailing empty fields
// instead of padding rows to the header width. Every case below is drawn from
// something a real export actually contains.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCSV } from '../../site/js/mydata.js';

describe('parseCSV', () => {
  test('plain rows', () => {
    assert.deepEqual(parseCSV('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('strips a UTF-8 BOM from the first header cell', () => {
    // Excel and some eBird downloads add one. Left in place it becomes part of
    // the first column name, so every header lookup fails and the import is
    // rejected as "not an eBird export".
    const rows = parseCSV('﻿Submission ID,Common Name\nS1,Kría');
    assert.equal(rows[0][0], 'Submission ID');
  });

  test('a quoted field may contain commas', () => {
    const rows = parseCSV('a,"one, two",c');
    assert.deepEqual(rows[0], ['a', 'one, two', 'c']);
  });

  test('"" is an escaped quote', () => {
    // A real export had 3,236 quote characters, mostly in Observation Details.
    const rows = parseCSV('a,"he said ""hi""",c');
    assert.deepEqual(rows[0], ['a', 'he said "hi"', 'c']);
  });

  test('a newline inside quotes does not end the record', () => {
    // Checklist Comments routinely span lines. Splitting on \n turns one
    // observation into two malformed ones.
    const rows = parseCSV('a,"line one\nline two",c\nx,y,z');
    assert.equal(rows.length, 2);
    assert.equal(rows[0][1], 'line one\nline two');
    assert.deepEqual(rows[1], ['x', 'y', 'z']);
  });

  test('CRLF endings', () => {
    assert.deepEqual(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  test('ragged rows are kept, not dropped', () => {
    // THE regression. eBird omits trailing empty fields rather than padding, so
    // a 23-column header is followed by rows of 16, 19, 20, 21, 22 and 23.
    // Requiring full width discarded all but 62 of 3,829 rows.
    const rows = parseCSV('a,b,c,d\n1,2\n3,4,5,6\n7');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[1], ['1', '2']);
    assert.deepEqual(rows[3], ['7']);
  });

  test('blank lines are skipped', () => {
    assert.deepEqual(parseCSV('a,b\n\n1,2\n'), [['a', 'b'], ['1', '2']]);
  });

  test('a final row without a trailing newline is kept', () => {
    const rows = parseCSV('a,b\n1,2');
    assert.deepEqual(rows[1], ['1', '2']);
  });

  test('a trailing empty field survives', () => {
    assert.deepEqual(parseCSV('a,b,')[0], ['a', 'b', '']);
  });

  test('an empty file yields no rows', () => {
    assert.deepEqual(parseCSV(''), []);
  });

  test('a realistic eBird row survives intact', () => {
    const csv = [
      'Submission ID,Common Name,Scientific Name,Count,State/Province,Location ID,' +
        'Location,Latitude,Longitude,Date,Time,Protocol,Observation Details',
      'S123,"Tern, Arctic",Sterna paradisaea,X,IS-1,L1234,"Tjörnin, Reykjavík",' +
        '64.145,-21.94,2026-06-30,06:15,Stationary,"seen well; ""adult"" plumage"',
      'S124,Kría,Sterna paradisaea,12,IS-1,L1234,Tjörnin,64.145,-21.94,2026-06-30'
    ].join('\n');
    const rows = parseCSV(csv);

    assert.equal(rows.length, 3);
    assert.equal(rows[1][1], 'Tern, Arctic');
    assert.equal(rows[1][3], 'X');                       // uncounted presence
    assert.equal(rows[1][6], 'Tjörnin, Reykjavík');
    assert.equal(rows[1][12], 'seen well; "adult" plumage');
    assert.equal(rows[2].length, 10);                    // short row, still read
    assert.equal(rows[2][9], '2026-06-30');
  });
});
