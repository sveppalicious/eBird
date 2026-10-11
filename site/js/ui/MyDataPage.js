// MyDataPage.js -- bringing your own eBird export in, replacing it, removing it.

import { html, useState, useApp, regionHref, Stat, ExtLink } from './core.js';
import { loadImportLookups } from '../data/remote.js';
import { saveMine, clearMine } from '../data/mine.js';
import { importExport, diffTables, summaryFor, firsts, regionStats } from '../lib/personal.js';
import { COUNTRY } from '../lib/regions.js';
import { fmtNum, fmtDate } from '../lib/format.js';

function MyDataPage() {
  const { mine, setMine, setSource, t, lang, meta, baseTree } = useApp();
  const [status, setStatus] = useState(null);       // { kind: 'busy'|'error'|'note', text }

  // One place where a file becomes stored data, so the first upload and
  // "replace" record the same thing: what this import added over the last.
  async function handle(file) {
    if (!file) return;
    setStatus({ kind: 'busy', text: t('import.reading', { name: file.name }) });
    try {
      const text = await file.text();
      const table = importExport(text, await loadImportLookups());
      const diff = diffTables(mine, table);
      if (diff && diff.added.length) table.lastImport = diff;
      const saved = await saveMine(table);
      setMine(table);
      setSource('mine');
      setStatus(saved ? null : { kind: 'note', text: t('import.sessionOnly') });
    } catch (err) {
      const key = err && err.code ? 'import.err.' + err.code : null;
      setStatus({ kind: 'error', text: key ? t(key, { column: err.column || '' }) : String((err && err.message) || err) });
    }
  }

  const statusBox = status ? html`<div class=${'upload-status is-' + status.kind} role="status">${status.text}</div>` : null;

  const privacy = html`<div class="privacy">
    <strong>${t('privacy.lead')}</strong>
    <p>${t('privacy.body')}</p>
    <p class="muted">${t('privacy.care')}</p>
  </div>`;

  const head = html`<header class="page-head">
    <h1>${t('me.title')}</h1>
    <p class="lede">${t('me.lede')}</p>
  </header>`;

  if (!mine) {
    return html`<article>${head}
      <label class="dropzone" for="csvfile"
        onDragOver=${e => { e.preventDefault(); e.currentTarget.classList.add('is-over'); }}
        onDragLeave=${e => e.currentTarget.classList.remove('is-over')}
        onDrop=${e => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); handle(e.dataTransfer.files[0]); }}>
        <div class="dropzone-icon" aria-hidden="true">↑</div>
        <div class="dropzone-main">${t('import.choose')}</div>
        <div class="dropzone-sub">${t('import.drag')}</div>
        <input type="file" id="csvfile" accept=".csv,text/csv" onChange=${e => handle(e.target.files[0])} />
      </label>
      ${statusBox}
      ${privacy}
      <div class="howto">
        <h3>${t('import.howTitle')}</h3>
        <ol>
          <li>${t('import.how1')} <${ExtLink} href="https://ebird.org/downloadMyData">ebird.org/downloadMyData<//></li>
          <li>${t('import.how2')}</li>
          <li>${t('import.how3')} <code>MyEBirdData.csv</code></li>
        </ol>
        <p class="note">${t('import.howNote')}</p>
      </div>
    </article>`;
  }

  const s = summaryFor(mine, COUNTRY).stats;
  // From your own numbers, whichever source the rest of the site is showing.
  const yours = regionStats(mine);
  const muns = baseTree.all().filter(r => r.kind === 'sveitarfelag');
  const visited = muns.filter(r => yours.has(r.id)).length;
  const total = muns.length;
  const news = mine.lastImport;
  const w = mine.warnings || {};

  return html`<article>${head}
    <div class="stats">
      <${Stat} lead value=${fmtNum(s.species)} label=${t('stat.speciesMine')} sub=${t('me.ofIceland', { n: fmtNum(meta.totals.species) })} />
      <${Stat} value=${fmtNum(visited)} label=${t('me.municipalities')} sub=${t('me.ofTotal', { n: fmtNum(total) })} />
      <${Stat} value=${fmtNum(s.checklists)} label=${t('stat.checklists')} />
      <${Stat} value=${fmtNum(firsts(mine).length)} label=${t('tab.firsts')}
               sub=${s.firstDate === null ? null : `${fmtDate(s.firstDate, lang)} – ${fmtDate(s.lastDate, lang)}`} />
    </div>

    ${news && news.added.length ? html`<div class="callout whatsnew">
      <strong>${t('firsts.since', { d: news.prevAt || '' })} </strong>
      <span>${[news.lifers.length ? t('firsts.newIceland', { n: fmtNum(news.lifers.length) }) : null,
               t('firsts.newTicks', { n: fmtNum(news.added.length) })].filter(Boolean).join(', ')}. </span>
      <a href=${regionHref(COUNTRY, { tab: 'firsts' })}>${t('firsts.seeAll')} →</a>
    </div>` : null}

    <p class="me-actions">
      <a class="button" href=${regionHref(COUNTRY)} onClick=${() => setSource('mine')}>${t('me.explore')} →</a>
      <a class="pill" href=${regionHref(COUNTRY, { tab: 'firsts' })} onClick=${() => setSource('mine')}>${t('tab.firsts')}</a>
    </p>

    <div class="controls">
      <label class="pill" for="csvreplace">${t('me.replace')}</label>
      <input type="file" id="csvreplace" accept=".csv,text/csv" class="visually-hidden"
             onChange=${e => handle(e.target.files[0])} />
      <button type="button" class="pill" onClick=${async () => { await clearMine(); setMine(null); setSource('all'); setStatus(null); }}>${t('me.remove')}</button>
      <span class="muted">${t('me.imported', { d: mine.imported })}</span>
    </div>
    ${statusBox}

    ${w.unplacedTotal || (w.unknownTaxa && w.unknownTaxa.length) || (w.notInDataset && w.notInDataset.length) ? html`<div class="warnings">
      ${w.notInDataset && w.notInDataset.length ? html`<p class="note">${t('me.notInDataset', { n: w.notInDataset.length })}
        ${' '}<i>${w.notInDataset.map(x => x.sci).join(', ')}</i></p>` : null}
      ${w.unplacedTotal ? html`<p class="note">${t('me.unplaced', { n: fmtNum(w.unplacedTotal) })}
        ${' '}${w.unplaced.slice(0, 5).map(u => u[0]).join('; ')}</p>` : null}
      ${w.unknownTaxa && w.unknownTaxa.length ? html`<p class="note">${t('me.unknownTaxa', { n: w.unknownTaxa.length })}
        ${' '}<i>${w.unknownTaxa.slice(0, 8).join(', ')}</i></p>` : null}
    </div>` : null}

    ${privacy}
  </article>`;
}

export { MyDataPage };
