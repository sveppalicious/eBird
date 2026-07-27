// format.js -- dates, numbers, names and the links back out to eBird.

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_IS = ['jan','feb','mar','apr','maí','jún','júl','ágú','sep','okt','nóv','des'];

// Dates travel as days since 1970-01-01 (compact, and sortable as integers).
function dayToDate(d) {
  return new Date(d * 86400000);
}

function fmtDate(d, lang) {
  if (d === null || d === undefined) return '';
  const dt = dayToDate(d);
  const m = (lang === 'is' ? MONTHS_IS : MONTHS_EN)[dt.getUTCMonth()];
  return `${dt.getUTCDate()} ${m} ${dt.getUTCFullYear()}`;
}

// Personal-export dates arrive as "YYYY-MM-DD"; the site's own dates are days
// since epoch. Convert so both render through the same formatter.
function isoToDay(iso) {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1,
                             +iso.slice(8, 10)) / 86400000);
}

function dayYear(d)  { return dayToDate(d).getUTCFullYear(); }
function dayMonth(d) { return dayToDate(d).getUTCMonth(); }

function fmtNum(n) {
  if (n === null || n === undefined) return '';
  // Icelandic groups thousands with a dot. Use it in both languages: the
  // audience is Icelandic, and it avoids the comma-vs-decimal ambiguity.
  return n.toLocaleString('de-DE');
}

// eBird writes "X" for present-but-not-counted. We store that as null and show
// it the way eBird does, rather than as a blank or a zero.
function fmtCount(n) {
  return (n === null || n === undefined) ? 'X' : fmtNum(n);
}

function fmtDuration(min) {
  if (min === null || min === undefined) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ---- eBird links ------------------------------------------------------------

const ebird = {
  checklist: sub => `https://ebird.org/checklist/${sub}`,

  // Personal locations have no public page; only hotspots get a link.
  hotspot: (loc, type) => (type === 'H' ? `https://ebird.org/hotspot/${loc}` : null),

  // Profile URLs are base64 of the numeric part of the observer id:
  // obsr113578 -> MTEzNTc4, confirmed against a profile link a user pasted into
  // a checklist comment in this very dataset.
  //
  // CAVEAT: that id is 6 digits, the one length whose base64 needs no padding.
  // 7-digit ids (86k checklists here) encode to a trailing "==", and whether
  // eBird's router wants those kept or stripped could not be confirmed --
  // checklist and profile pages both redirect to login when signed out. Standard
  // base64 keeps the padding, so that is what we emit. If a padded link 404s
  // while a 6-digit one works, flip STRIP_BASE64_PADDING and rebuild nothing:
  // this is the only place it is used.
  observer: obsr => {
    let token = btoa(String(obsr).replace(/^obsr/, ''));
    if (ebird.STRIP_BASE64_PADDING) token = token.replace(/=+$/, '');
    return `https://ebird.org/profile/${token}/world`;
  },
  STRIP_BASE64_PADDING: false,

  // Municipalities are not eBird regions, so the closest eBird can scope a
  // species page is the parent region.
  species: (code, region) => `https://ebird.org/species/${code}/${region || 'IS'}`,

  region: code => `https://ebird.org/region/${code}`
};

// ---- species names ----------------------------------------------------------

// The taxonomy carries both languages. `hasIs` is false where eBird has no
// Icelandic name and simply echoes the English one back.
function spName(tax, lang) {
  if (!tax) return '?';
  if (lang === 'is' && tax.hasIs) return tax.is;
  return tax.en;
}

function spSecondary(tax, lang) {
  if (!tax) return '';
  if (lang === 'is' && tax.hasIs) return tax.en;
  return tax.sci;
}

// ---- small DOM helpers ------------------------------------------------------

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

function extLink(href, text, cls) {
  if (!href) return el('span', { class: cls || '' }, text);
  return el('a', { class: cls || '', href, target: '_blank', rel: 'noopener' }, text);
}

export {
  MONTHS_EN, MONTHS_IS, dayToDate, fmtDate, dayYear, dayMonth, isoToDay,
  fmtNum, fmtCount, fmtDuration, ebird, spName, spSecondary, el, extLink
};
