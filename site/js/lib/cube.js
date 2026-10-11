// cube.js -- everything the charts, year lists and arrival dates are made of.
//
// A cube is one region's records cut by species, year and month, plus the
// effort they have to be divided by. It has the same shape whether it came off
// the server (everyone's data) or was built in the browser from a personal
// export, which is why no chart knows whose data it is drawing.
//
//   sp[]                     species codes; `si` indexes into it
//   si, y, m, n, c           species x year x month: checklists with the
//                            species, and how many of those were complete
//   ysi, yy, yf, yl          species x year: first and last day
//   ey, em, en, ec           year x month: all checklists, complete checklists
//
// Pure functions, no DOM.

import { dayOfYear } from './format.js';

// Below this many complete checklists a region-year cannot carry a frequency:
// one visit that happened to find a bird reads as "seen on 100% of checklists".
// Iceland has 615 complete checklists for the whole of the 1980s and 105,012
// for the 2020s, so this bites hard on anything before about 2010.
const THIN_YEAR = 50;
// The same idea for one calendar month pooled over the chosen years.
const THIN_MONTH = 20;

const indexes = new WeakMap();

// Ranges per species (the cells are sorted by species) and effort lookups,
// built once per cube.
function index(cube) {
  let ix = indexes.get(cube);
  if (ix) return ix;

  const range = (col) => {
    const out = new Map();
    for (let i = 0; i < col.length; i++) {
      const r = out.get(col[i]);
      if (r) r[1] = i + 1; else out.set(col[i], [i, i + 1]);
    }
    return out;
  };

  const effort = new Map();          // year*12 + month-1 -> [n, c]
  const effortYear = new Map();      // year -> [n, c]
  for (let i = 0; i < cube.ey.length; i++) {
    effort.set(cube.ey[i] * 12 + cube.em[i] - 1, [cube.en[i], cube.ec[i]]);
    const e = effortYear.get(cube.ey[i]) || [0, 0];
    e[0] += cube.en[i]; e[1] += cube.ec[i];
    effortYear.set(cube.ey[i], e);
  }

  ix = {
    code: new Map(cube.sp.map((c, i) => [c, i])),
    cells: range(cube.si),
    years: range(cube.ysi),
    effort, effortYear,
    allYears: [...effortYear.keys()].sort((a, b) => a - b)
  };
  indexes.set(cube, ix);
  return ix;
}

const freq = (c, ec) => (ec > 0 ? c / ec : null);

// Every year this region has any checklists for, oldest first.
function effortYears(cube) {
  const ix = index(cube);
  return ix.allYears.map(year => {
    const [n, c] = ix.effortYear.get(year);
    return { year, n, c, thin: c < THIN_YEAR };
  });
}

// A year with fewer complete checklists than this is not drawn at all unless
// it sits inside the span: there is nothing in it to show, flagged or not.
const SHOWN_YEAR = 10;

// The span worth drawing by default. It starts at the first year with enough
// complete checklists to mean something -- a chart that starts in 1844 is one
// tall bar and a century of nothing -- and then reaches back over the lighter
// years directly before it, which are drawn pale rather than dropped. That
// matters most for one person's data, where every year is "thin" by national
// standards and hiding them would hide most of their birding.
function chartSpan(cube, maxYears = 30) {
  const ys = effortYears(cube);
  if (!ys.length) return null;
  const to = ys[ys.length - 1].year;
  let i = ys.findIndex(y => !y.thin);
  if (i < 0) i = ys.findIndex(y => y.c >= SHOWN_YEAR);
  if (i < 0) i = 0;
  while (i > 0 && ys[i - 1].year === ys[i].year - 1 && ys[i - 1].c >= SHOWN_YEAR) i--;
  let from = ys[i].year;
  if (to - from + 1 > maxYears) from = to - maxYears + 1;
  return { from, to };
}

// One species by year. Every year in the span is returned, including the ones
// where it was not recorded, so the bars keep their place on the axis.
function byYear(cube, code, span) {
  const ix = index(cube);
  const s = span || chartSpan(cube);
  if (!s) return [];
  const n = new Map(), c = new Map();
  const si = ix.code.get(code);
  const r = si === undefined ? null : ix.cells.get(si);
  if (r) {
    for (let i = r[0]; i < r[1]; i++) {
      n.set(cube.y[i], (n.get(cube.y[i]) || 0) + cube.n[i]);
      c.set(cube.y[i], (c.get(cube.y[i]) || 0) + cube.c[i]);
    }
  }
  const out = [];
  for (let year = s.from; year <= s.to; year++) {
    const e = ix.effortYear.get(year) || [0, 0];
    out.push({
      year, n: n.get(year) || 0, c: c.get(year) || 0, en: e[0], ec: e[1],
      freq: freq(c.get(year) || 0, e[1]), thin: e[1] < THIN_YEAR
    });
  }
  return out;
}

// One species by calendar month, pooled over the span. Pooling is what makes a
// month comparable: each month's records are divided by that month's own
// effort, so June does not win simply because that is when birders are out.
function byMonth(cube, code, span) {
  const ix = index(cube);
  const s = span || chartSpan(cube);
  const out = Array.from({ length: 12 }, (_, m) => ({ month: m, n: 0, c: 0, en: 0, ec: 0 }));
  if (!s) return out.map(o => ({ ...o, freq: null, thin: true }));

  for (let i = 0; i < cube.ey.length; i++) {
    if (cube.ey[i] < s.from || cube.ey[i] > s.to) continue;
    out[cube.em[i] - 1].en += cube.en[i];
    out[cube.em[i] - 1].ec += cube.ec[i];
  }
  const si = ix.code.get(code);
  const r = si === undefined ? null : ix.cells.get(si);
  if (r) {
    for (let i = r[0]; i < r[1]; i++) {
      if (cube.y[i] < s.from || cube.y[i] > s.to) continue;
      out[cube.m[i] - 1].n += cube.n[i];
      out[cube.m[i] - 1].c += cube.c[i];
    }
  }
  return out.map(o => ({ ...o, freq: freq(o.c, o.ec), thin: o.ec < THIN_MONTH }));
}

// Year x month grid of frequency. A cell is null where nobody submitted a
// complete checklist that month -- "no data", which is not the same as "0%"
// and must not be drawn as if it were.
function heat(cube, code, span) {
  const ix = index(cube);
  const s = span || chartSpan(cube);
  if (!s) return [];
  const cells = new Map();
  const si = ix.code.get(code);
  const r = si === undefined ? null : ix.cells.get(si);
  if (r) {
    for (let i = r[0]; i < r[1]; i++) {
      cells.set(cube.y[i] * 12 + cube.m[i] - 1, [cube.n[i], cube.c[i]]);
    }
  }
  const out = [];
  for (let year = s.to; year >= s.from; year--) {
    const months = [];
    for (let m = 0; m < 12; m++) {
      const e = ix.effort.get(year * 12 + m);
      const v = cells.get(year * 12 + m) || [0, 0];
      months.push({ n: v[0], c: v[1], ec: e ? e[1] : 0, freq: e ? freq(v[1], e[1]) : null });
    }
    out.push({ year, months, thin: (ix.effortYear.get(year) || [0, 0])[1] < THIN_YEAR });
  }
  return out;
}

// Is this a bird with a season here? Arrival dates only mean something for
// one: a resident's "first date" is whenever somebody first went out in
// January. Judged on the calendar-month frequencies -- a clear winter gap
// relative to the peak -- rather than on a list of migrants, so it adapts to
// the region and to the personal data too.
function isSeasonal(cube, code, span) {
  const months = byMonth(cube, code, span);
  const peak = Math.max(...months.map(m => m.freq || 0));
  if (!(peak > 0)) return false;
  const winter = Math.max(months[11].freq || 0, months[0].freq || 0, months[1].freq || 0);
  return winter < peak * 0.12;
}

// First day of each year, as a day-of-year so years line up on one axis.
// Thin years are flagged rather than dropped: an early date in a year with
// plenty of observers means more than one from a year with a handful.
function arrivals(cube, code, span) {
  const ix = index(cube);
  const s = span || chartSpan(cube);
  const si = ix.code.get(code);
  const r = si === undefined ? null : ix.years.get(si);
  if (!r || !s) return [];
  const out = [];
  for (let i = r[0]; i < r[1]; i++) {
    const year = cube.yy[i];
    if (year < s.from || year > s.to) continue;
    out.push({
      year, day: cube.yf[i], doy: dayOfYear(cube.yf[i]),
      last: cube.yl[i],
      thin: (ix.effortYear.get(year) || [0, 0])[1] < THIN_YEAR
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

// A region's list for one year: which species, on how many checklists, and the
// first and last date they were recorded in it.
function yearList(cube, year) {
  const n = new Map(), c = new Map();
  for (let i = 0; i < cube.si.length; i++) {
    if (cube.y[i] !== year) continue;
    n.set(cube.si[i], (n.get(cube.si[i]) || 0) + cube.n[i]);
    c.set(cube.si[i], (c.get(cube.si[i]) || 0) + cube.c[i]);
  }
  const out = [];
  for (let i = 0; i < cube.ysi.length; i++) {
    if (cube.yy[i] !== year) continue;
    const si = cube.ysi[i];
    out.push({ c: cube.sp[si], k: n.get(si) || 0, kc: c.get(si) || 0,
               first: cube.yf[i], last: cube.yl[i] });
  }
  return out;
}

// Coverage over time: species and checklists per year. `countable` is the set
// of codes that count as species, so a year's total is a list total and not a
// tally of every "gull sp.".
function activity(cube, countable) {
  const ix = index(cube);
  const species = new Map();
  for (let i = 0; i < cube.ysi.length; i++) {
    if (countable && !countable.has(cube.sp[cube.ysi[i]])) continue;
    species.set(cube.yy[i], (species.get(cube.yy[i]) || 0) + 1);
  }
  return ix.allYears.map(year => {
    const [n, c] = ix.effortYear.get(year);
    return { year, species: species.get(year) || 0, checklists: n, complete: c,
             thin: c < THIN_YEAR };
  });
}

// Complete checklists over a span -- the denominator of an all-years frequency.
function completeIn(cube, span) {
  let ec = 0;
  for (let i = 0; i < cube.ey.length; i++) {
    if (span && (cube.ey[i] < span.from || cube.ey[i] > span.to)) continue;
    ec += cube.ec[i];
  }
  return ec;
}

export {
  THIN_YEAR, THIN_MONTH, SHOWN_YEAR, effortYears, chartSpan, byYear, byMonth, heat,
  isSeasonal, arrivals, yearList, activity, completeIn
};
