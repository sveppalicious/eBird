// Charts.js -- bars, a heatmap and a dot plot, drawn as SVG.
//
// House rules, from the dataviz method the project follows:
//   * one series, one colour -- a bar is never shaded by its own value;
//   * bars at most 24px wide with a 2px gap, rounded at the data end only;
//   * hairline solid gridlines, text in text colours rather than data colours;
//   * every mark answers to hover *and* keyboard focus, and every chart has a
//     table twin, so a tooltip is never the only way to read a value;
//   * never two y-scales on one plot.
//
// A pale bar is not a smaller value: it marks a year with too few complete
// checklists to trust, which is a different thing and gets its own legend line.

import { html, useRef, useState, useEffect } from './core.js';

const SERIES = '#4b7b91';
const SERIES_PALE = '#bcd0d9';
const GRID = '#e3e8ea';
const INK = '#5d7280';
// One hue, light to dark, for the heatmap.
const SEQ = ['#e7f0f3', '#c3d9e1', '#93b9c8', '#6497ab', '#417b91', '#2c5f75', '#1d4558'];

function seqColor(t) {
  if (!Number.isFinite(t) || t <= 0) return SEQ[0];
  const x = Math.min(0.999, t) * (SEQ.length - 1);
  const i = Math.floor(x), f = x - i;
  const ch = k => Math.round(parseInt(SEQ[i].substr(k, 2), 16) +
    (parseInt(SEQ[i + 1].substr(k, 2), 16) - parseInt(SEQ[i].substr(k, 2), 16)) * f)
    .toString(16).padStart(2, '0');
  return '#' + ch(1) + ch(3) + ch(5);
}

// Charts are drawn at the size they are shown, not scaled, so type and bar
// widths stay what they were designed to be on a phone as on a desktop.
function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const measure = () => { const cw = ref.current.clientWidth; if (cw) setW(cw); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

// 0, a round number, and a round top: 0 / 20% / 40%, or 0 / 500 / 1,000.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-12) return m * p;
  return 10 * p;
}

function Tip({ tip }) {
  if (!tip) return null;
  return html`<div class="chart-tip" style=${`left:${tip.x}px; top:${tip.y}px`}>
    <strong>${tip.value}</strong><span>${tip.label}</span>
    ${tip.detail ? html`<span class="chart-tip-detail">${tip.detail}</span>` : null}
  </div>`;
}

// The frame every chart sits in: a title that says what is plotted (one series
// needs no legend box), an optional note, and the table twin.
function ChartCard({ title, note, legend, table, tableLabel, children }) {
  return html`<figure class="chart">
    <figcaption>
      <h3>${title}</h3>
      ${note ? html`<p class="chart-note">${note}</p>` : null}
    </figcaption>
    ${children}
    ${legend || null}
    ${table ? html`<details class="chart-table">
      <summary>${tableLabel}</summary>
      <div class="table-wrap"><table class="table">
        <thead><tr>${table.head.map(h => html`<th>${h}</th>`)}</tr></thead>
        <tbody>${table.rows.map(r => html`<tr>${r.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody>
      </table></div>
    </details>` : null}
  </figure>`;
}

/**
 * bars: [{ key, label, value, pale, tipValue, tipLabel, tipDetail }]
 * `value` null means "nothing to divide by" and draws no bar at all, which is
 * different from a bar of height zero.
 */
function BarChart({ bars, format, height = 190, labelEvery }) {
  const host = useRef(null);
  const width = useWidth(host);
  const [hover, setHover] = useState(null);

  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const iw = Math.max(40, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const top = niceMax(Math.max(0, ...bars.map(b => b.value || 0)));
  const band = iw / Math.max(1, bars.length);
  const bw = Math.max(1, Math.min(24, band - 2));
  const y = v => pad.t + ih - (v / top) * ih;
  const ticks = [0, top / 2, top];
  // Thin the x labels until they stop colliding.
  const every = labelEvery || Math.max(1, Math.ceil(34 / band));

  const show = i => {
    const b = bars[i];
    setHover({ i, x: pad.l + band * i + band / 2, y: b.value === null ? pad.t + ih - 8 : y(b.value) - 6,
               value: b.tipValue, label: b.tipLabel, detail: b.tipDetail });
  };

  return html`<div class="chart-plot" ref=${host} style=${`height:${height}px`}>
    <svg width=${width} height=${height} role="img">
      ${ticks.map(v => html`<g>
        <line x1=${pad.l} x2=${width - pad.r} y1=${y(v)} y2=${y(v)} stroke=${GRID} stroke-width="1" />
        <text x=${pad.l - 6} y=${y(v) + 4} text-anchor="end" class="chart-axis">${format(v)}</text>
      </g>`)}
      ${bars.map((b, i) => {
        const x = pad.l + band * i + (band - bw) / 2;
        const h = b.value === null ? 0 : Math.max(b.value > 0 ? 1.5 : 0, pad.t + ih - y(b.value));
        const r = Math.min(4, bw / 2, h);
        const yy = pad.t + ih - h;
        // Rounded at the data end, square on the baseline.
        const d = h > 0 ? `M${x},${pad.t + ih}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${pad.t + ih}Z` : '';
        return html`<g>
          ${d ? html`<path d=${d} fill=${b.pale ? SERIES_PALE : SERIES}
                          opacity=${hover && hover.i !== i ? 0.55 : 1} />` : null}
          ${i % every === 0 ? html`<text x=${pad.l + band * i + band / 2} y=${height - 7}
                                        text-anchor="middle" class="chart-axis">${b.label}</text>` : null}
          <rect x=${pad.l + band * i} y=${pad.t} width=${band} height=${ih} fill="transparent"
                tabindex="0" class="chart-hit" aria-label=${`${b.tipLabel}: ${b.tipValue}`}
                onPointerEnter=${() => show(i)} onPointerLeave=${() => setHover(null)}
                onFocus=${() => show(i)} onBlur=${() => setHover(null)} />
        </g>`;
      })}
    </svg>
    <${Tip} tip=${hover} />
  </div>`;
}

/**
 * rows: [{ label, pale, cells: [{ value (0..1 or null), tipValue, tipLabel, tipDetail }] }]
 * A null cell is "no complete checklists that month" -- drawn as an empty
 * outline, never as the lightest colour, because nothing was looked for.
 */
function Heatmap({ rows, columns, max, format }) {
  const host = useRef(null);
  const width = useWidth(host);
  const [hover, setHover] = useState(null);

  const labelW = 44, headH = 18, cellH = 16, gap = 2;
  const cw = Math.max(8, (width - labelW) / columns.length);
  const height = headH + rows.length * (cellH + gap);
  const top = max > 0 ? max : 1;

  return html`<div>
    <div class="chart-plot" ref=${host} style=${`height:${height}px`}>
      <svg width=${width} height=${height} role="img">
        ${columns.map((c, j) => html`<text x=${labelW + cw * j + cw / 2} y="12" text-anchor="middle" class="chart-axis">${c}</text>`)}
        ${rows.map((row, i) => {
          const yy = headH + i * (cellH + gap);
          return html`<g>
            <text x=${labelW - 8} y=${yy + cellH - 4} text-anchor="end"
                  class=${'chart-axis' + (row.pale ? ' is-pale' : '')}>${row.label}</text>
            ${row.cells.map((cell, j) => {
              const x = labelW + cw * j + gap / 2;
              const on = hover && hover.i === i && hover.j === j;
              return html`<rect x=${x} y=${yy} width=${cw - gap} height=${cellH} rx="2"
                fill=${cell.value === null ? '#fff' : seqColor(cell.value / top)}
                stroke=${on ? '#23313a' : (cell.value === null ? GRID : 'none')} stroke-width=${on ? 1.5 : 1}
                tabindex="0" class="chart-hit" aria-label=${`${cell.tipLabel}: ${cell.tipValue}`}
                onPointerEnter=${() => setHover({ i, j, x: x + cw / 2, y: yy - 4, value: cell.tipValue, label: cell.tipLabel, detail: cell.tipDetail })}
                onPointerLeave=${() => setHover(null)}
                onFocus=${() => setHover({ i, j, x: x + cw / 2, y: yy - 4, value: cell.tipValue, label: cell.tipLabel, detail: cell.tipDetail })}
                onBlur=${() => setHover(null)} />`;
            })}
          </g>`;
        })}
      </svg>
      <${Tip} tip=${hover} />
    </div>
    <div class="chart-legend">
      <span>${format(0)}</span>
      <span class="legend-bar" style=${`background: linear-gradient(90deg, ${SEQ.join(', ')})`}></span>
      <span>${format(top)}</span>
    </div>
  </div>`;
}

/**
 * points: [{ key, label (x tick), y (number), pale, tipValue, tipLabel }]
 * A dot per year. `yTicks` are [{ y, label }], so the axis can speak in dates.
 */
function DotChart({ points, yTicks, yMin, yMax, guide, height = 200 }) {
  const host = useRef(null);
  const width = useWidth(host);
  const [hover, setHover] = useState(null);

  const pad = { l: 52, r: 10, t: 12, b: 24 };
  const iw = Math.max(40, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const band = iw / Math.max(1, points.length);
  const y = v => pad.t + ih - ((v - yMin) / Math.max(1, yMax - yMin)) * ih;
  const every = Math.max(1, Math.ceil(34 / band));

  return html`<div class="chart-plot" ref=${host} style=${`height:${height}px`}>
    <svg width=${width} height=${height} role="img">
      ${yTicks.map(tk => html`<g>
        <line x1=${pad.l} x2=${width - pad.r} y1=${y(tk.y)} y2=${y(tk.y)} stroke=${GRID} stroke-width="1" />
        <text x=${pad.l - 6} y=${y(tk.y) + 4} text-anchor="end" class="chart-axis">${tk.label}</text>
      </g>`)}
      ${guide ? html`<g>
        <line x1=${pad.l} x2=${width - pad.r} y1=${y(guide.y)} y2=${y(guide.y)} stroke=${INK} stroke-width="1" />
        <text x=${width - pad.r} y=${y(guide.y) - 5} text-anchor="end" class="chart-axis is-strong">${guide.label}</text>
      </g>` : null}
      ${points.map((p, i) => {
        const cx = pad.l + band * i + band / 2;
        const on = hover && hover.i === i;
        return html`<g>
          ${i % every === 0 ? html`<text x=${cx} y=${height - 7} text-anchor="middle" class="chart-axis">${p.label}</text>` : null}
          ${p.y === null ? null : html`
            <circle cx=${cx} cy=${y(p.y)} r=${on ? 6 : 4.5} fill=${p.pale ? '#fff' : SERIES}
                    stroke=${p.pale ? SERIES : '#fff'} stroke-width="2" />
            <circle cx=${cx} cy=${y(p.y)} r="12" fill="transparent" tabindex="0" class="chart-hit"
                    aria-label=${`${p.tipLabel}: ${p.tipValue}`}
                    onPointerEnter=${() => setHover({ i, x: cx, y: y(p.y) - 10, value: p.tipValue, label: p.tipLabel, detail: p.tipDetail })}
                    onPointerLeave=${() => setHover(null)}
                    onFocus=${() => setHover({ i, x: cx, y: y(p.y) - 10, value: p.tipValue, label: p.tipLabel, detail: p.tipDetail })}
                    onBlur=${() => setHover(null)} />`}
        </g>`;
      })}
    </svg>
    <${Tip} tip=${hover} />
  </div>`;
}

// The one legend line the bar charts need: what a pale bar means.
const PaleLegend = ({ text }) => html`<div class="chart-legend">
  <span class="legend-swatch" style=${`background:${SERIES_PALE}`}></span><span>${text}</span>
</div>`;

export { BarChart, Heatmap, DotChart, ChartCard, PaleLegend, niceMax, seqColor, SERIES, SERIES_PALE };
