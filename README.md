# eBird Ísland — sveitarfélög

[![Tests](https://github.com/sveppalicious/eBird/actions/workflows/ci.yml/badge.svg)](https://github.com/sveppalicious/eBird/actions/workflows/ci.yml)
[![Deploy](https://github.com/sveppalicious/eBird/actions/workflows/pages.yml/badge.svg)](https://github.com/sveppalicious/eBird/actions/workflows/pages.yml)

**[sveppalicious.github.io/eBird](https://sveppalicious.github.io/eBird/)**

eBird exposes three sub-national levels for Denmark but only two for Iceland:
country → landshluti (IS-1 … IS-8) → nothing. This project adds the missing
ones — **sveitarfélög**, and below them **hverfi and póstnúmer** — for exploring
what has been recorded where and when, by everyone or by you.

## How the site is put together

**One concept: a region.** Iceland, each of the 62 sveitarfélög and each of the
187 hverfi and póstnúmer is the same kind of thing: the same files from the same
writer, and the same page.

**One switch: whose data.** *Everyone | My data*, in the header. Both sources
answer the same questions in the same shapes, so no page knows which it is
showing.

| Route | Page |
|---|---|
| `#/` , `#/r/{regionId}` | a **region**: stats, map, and tabs for species, areas, checklists, activity |
| `#/s/{code}` , `#/s/{code}/{regionId}` | a **species**, scoped to any region: when, where, and the records |
| `#/me` | upload, replace or remove your own eBird export |

A tab or a year rides in the query (`#/r/x?tab=checklists&year=2026`), so every
view is a link. The first version of the site used other URLs (`#/mun/…`,
`#/species/…`); they redirect.

There is no navigation bar. One search box finds species and places, accents
optional — *kria*, *thingey* — and replaces it.

The earlier site grew a feature at a time, and it showed: Iceland was a map and
a table of children with no bird list, a sveitarfélag was a bird list with its
children behind a tab, a póstnúmer was a bird list computed another way from
other files, and the species pages split the same way — national had a map and
no charts, municipal a chart and no map. The rewrite is mostly the removal of
those differences.

### A region page

Identical at all three levels: breadcrumb, four stats, the map, then

- **Species** — the list, which at `#/` *is* the list of every species recorded
  in Iceland. A year selector turns it into that year's list.
- **Areas** — the regions one level down. Absent where there is no level below,
  which includes the 16 sveitarfélög covered by a single postal area: one child
  is the same place again under another heading.
- **Checklists** — every checklist, with a Find box. The country shows the
  latest 2,000 of 235,811 and says so.
- **Activity** — species and checklists per year: how coverage has grown, and
  which years are too thin to trust.
- **Firsts** — in *My data* only; see below.

### A species page

Identical at all three levels:

- **By year** and **by month**, as *frequency*: the share of complete checklists
  that reported the species. This is the definition eBird's own bar charts use,
  and it is the only honest one. Iceland has 615 complete checklists for the
  whole of the 1980s and 105,012 for the 2020s; a chart of raw counts is a chart
  of eBird's growth. Years under 50 complete checklists are drawn pale rather
  than hidden, and the counts are on hover and in each chart's table.
- **Year by month** — the two together, so a season lengthening or shifting
  shows at a glance. An empty cell is a month nobody submitted a complete
  checklist, which is not 0% and is not drawn as if it were.
- **First record of each year** — arrival dates, for species with a season. It
  is offered only where the calendar-month frequencies show a real winter gap:
  a resident's "first date" is whenever somebody first went out in January. The
  chart says plainly that more observers find birds sooner, so early years are
  not strictly comparable.
- **Where** — the regions below, on the map and as a table.
- **Records** — every one, newest first (the latest 50 at country level).

All four charts read `cube.json` — see *Data files* — which is why they work for
Iceland without the browser downloading 1.6 million observations.

### The map

[Leaflet](https://leafletjs.com), vendored under `site/vendor/` and drawing
only this site's own polygons. No tile layer: the page requests nothing from
any other host, and a test watches the network to keep it that way.

The container's height is set in CSS (`--map-h`) and nothing about the data can
change it. That one fact replaces a hand-rolled SVG map whose height was derived
from its viewBox, with three consequences measured on the live site before the
rewrite:

- **it shook** — the height changed on 13 of 14 wheel ticks, because the viewBox
  was rounded to two decimals and the aspect ratio drifted as you zoomed;
- **it flashed** — a wheel tick needing the same 9 tiles kept 0 of 9, destroying
  and re-requesting all of them;
- **it stood 475 px tall for Grindavík and 1,819 px for Eyjafjarðarsveit.**

One map instance lives for the life of the page; navigating restyles the shapes
and flies to the region. A region with children shows them; a leaf shows itself
among its siblings, so there is always something next door to click. On a touch
screen a one-finger drag scrolls the page and pinch zooms the map — a map that
swallows the scroll gesture traps a phone user above it.

## Your own data

`#/me` takes the `MyEBirdData.csv` from
[ebird.org/downloadMyData](https://ebird.org/downloadMyData). After that the
*My data* switch shows the same pages drawn from your records: your list for
Iceland, a sveitarfélag or a hverfi; your year lists; your checklists; the
species charts on your own sightings; and your localities as dots on the map.

**The file never leaves your browser.** It is read and parsed on the page and
kept in that browser's IndexedDB on that device. The site is static files with
no server to receive it, and "Remove my data" erases it. An eBird export is a
detailed history of where somebody has been and when — the design treats it that
way, and three tests hold it to that: the import and storage modules contain no
network code at all, the one `fetch` in the site is a GET of a relative `data/`
path, and a browser test watches every request during a real import.

The export is reduced to a compact table of **observations**, not to totals.
Everything else — a region's species list, its cube, its checklists, the firsts —
is derived from that table (`site/js/lib/personal.js`) in the same shapes the
published files have. That is what lets every page work on your data with no
code of its own, and the unit tests check it directly by feeding a personal
cube to the chart functions.

Three quirks of the personal export that the importer handles, and that a naive
reader gets wrong:

- **Rows are ragged.** eBird drops trailing empty fields rather than padding, so
  a 23-column header is followed by rows of 16 to 23 fields. Requiring
  full-width rows silently discards ~98% of the file.
- **It names the sub-taxon.** `Scientific Name` holds `Anser anser anser` or
  `Columba livia (Feral Pigeon)` where the EBD holds the parent binomial, so a
  plain join matches only about 80% of taxa. `sci_index.json` maps every
  taxonomy name to its reportable species, and carries that species' category so
  spuh/slash/hybrid entries are not miscounted as species. Two sub-taxa of one
  species on one checklist become one record of it.
- **It can run ahead of the EBD.** A species you have seen that is not in this
  release yet — a pending rarity, or a record after the cut-off — still counts,
  and the upload page names it.

Localities are matched by eBird Location ID against `locality_index.json`
(361 of 372 in a real export). Anything left — typically a locality newer than
the EBD release — is placed by testing its coordinates against the area
polygons and then the sveitarfélag polygons, in the browser.

Verified against a real export: the importer reproduces eBird's own figures
exactly — **105 species and 677 checklists** for Iceland, and **83 species over
289 checklists** for Höfuðborgarsvæði, matching that account's eBird pages.

### Firsts

The *Firsts* tab is the reason to keep uploading: every time a species was new
for a sveitarfélag, hverfi or póstnúmer, newest first, at whatever region you
are looking at. For this export that is 1,619 firsts across 41 sveitarfélög —
a species counts again at each level, which is what keeps a well-birded country
interesting.

Three decisions worth recording, each of which produced a wrong number first.

**One row per event, not per tick.** A bird that is new for a hverfi on the same
day it is new for the sveitarfélag around it is one thing that happened; listing
it twice made a first visit somewhere read as a flurry of activity. Rows are
keyed on `(species, date, sveitarfélag)`.

**The "first in Iceland" badge appears once per species.** A day out by car can
put a bird's national first date on several municipalities at once, and the
badge was appearing on each — 126 of them against a 105-species list.

**Only species get the badge.** The records also hold spuh, slash and hybrid
rows: "gull sp." is a real thing to have logged in a place, but it is not
something you add to a life list. With that fixed the lifer count is exactly
105 — one per species on the list, which is the cross-check that says the
arithmetic is right.

On upload, the new file is compared against the one it replaces and the page
leads with what changed. It is a **set difference, never a date cutoff**: eBird
exports get backfilled — an old notebook typed up, a shared checklist accepted
late — and those are new to your list even though the sighting is not new. A
first upload reports nothing, because "everything is new" is not news.

## Language

**ÍS / EN switches the whole interface**, not only the species names. Most of
the eBirders in this data are visitors and most of the people who will care
about a list for their sveitarfélag are not, so neither language is the
afterthought. A first visit follows the browser's language.

Icelandic declines place names and a template cannot: "í {name}" needs the
dative of whatever is dropped into it. The Icelandic strings are therefore
written so that a name only ever stands in the nominative — after a colon, or in
apposition ("á svæðinu {region}") — and a test rejects any string that puts one
after a preposition.

## Why it has to be built rather than fetched

The `COUNTY` and `COUNTY CODE` columns are **empty on all 2,002,096 Iceland rows**
of the eBird Basic Dataset — eBird has no municipality layer for Iceland to
serve. But every row carries a latitude and longitude, and those coordinates
hang off `LOCALITY ID`, not off individual observations. So the whole problem
reduces to **40,770 point-in-polygon tests**, not two million.

The boundaries come from Landmælingar Íslands over their live WFS
(`IS_50V:mork_sveitarf_svaedi`, 61 municipalities, dataset version 2026-07-06).

## The fourth level: hverfi, else póstnúmer

Below the sveitarfélag sits a fourth level, drawn from whichever of two national
layers actually fits the municipality:

| Layer | Names? | Municipalities it subdivides |
|---|---|---:|
| Hagstofa neighbourhoods, `tlsv` in `smasvaedi_2021` | **yes** — *Miðborg*, *Árbær*, *Vesturbær suður* | 5 |
| Byggðastofnun **póstnúmer** | no — *640 Húsavík* | 45 |

Neither works alone. The neighbourhood layer carries the real names but only
splits the capital area and Akureyri; elsewhere it is *coarser* than a
sveitarfélag — one of its areas merges Mosfellsbær with Kjós, another covers all
of Vestfirðir. Postal codes cover the country but are not place names.

So each municipality gets the neighbourhood layer if it genuinely splits it, and
postal codes otherwise: **26 named hverfi across 5 municipalities, 160 postal
areas across 56**. Reykjavíkurborg comes out as its 13 real neighbourhoods, from
Miðborg (107 species, 7,670 checklists) down to Seljahverfi.

**A neighbourhood belongs to whichever municipality holds most of it.** That is
what removes boundary bleed between the agencies' outlines, and it has to be
scale-free: a threshold relative to the municipality cannot work, because
Reykjavíkurborg is 244 km² of which Grafarholt og Kjalarnes is more than half —
1% of it would discard Miðborg, Hlíðar and every other small dense
neighbourhood.

Either way an area is the **intersection** of the municipality with the chosen
layer, never the layer polygon itself, so nesting is true by construction: each
area lies wholly inside one sveitarfélag and together they tile it. `run_all.R`
asserts that every checklist outside Hafsvæði has exactly one.

An area is a region like any other, with its own `summary.json` and `cube.json`,
so its page loads as fast as a sveitarfélag's. Only the two heavy files are
shared: an area is a column on its parent's `checklists.json`, which `obs.json`
indexes into, so the checklist browser and the record tables filter the
parent's files rather than tripling them. A region's id is its sveitarfélag and
a code — a name slug where there is a name (`0000-reykjavikurborg-midborg`), the
number otherwise (`6100-nordurthing-640`).

**A postal district can straddle a municipality boundary**, and cutting it to
the municipality is what keeps the tiling true — so the same póstnúmer survives
as one area per municipality it reaches. 14 districts are split this way, into
31 of the 187 areas; 660 Mývatn is the extreme case, with 6,048 km² in
Þingeyjarsveit and interior slices of about 200 km² each in Norðurþing and
Múlaþing. They are not duplicates, but the *label* names the district rather
than the slice, so three polygons on one map legitimately read "660 Mývatn".
The map tooltip carries the sveitarfélag underneath the label, and each area
page names the others and links to them. `run_all.R` reports the count.

**Areas with no checklists are still exported.** They exist on the map and are
clickable, so they have to exist as regions: taking the list from the observed
checklists once left 806 in Grímsnes- og Grafningshreppur drawn but absent from
the data, a polygon that linked to "No such póstnúmer here". The regions now
come from the geometry, and both `run_all.R` and the data tests assert that
every shape on the map is a region with its files.

## Data files

`R/05_export_json.R` is built around one function, `export_region()`, called for
Iceland, each sveitarfélag and each area:

```
data/meta.json                     release, date range, totals
data/regions.json                  the tree: id, parent, kind, name, headline stats
data/region/{id}/summary.json      stats + one row per species (all years)
data/region/{id}/cube.json         species x year x month, with effort
data/region/{mun}/checklists.json  the checklist browser (areas reuse their parent's)
data/region/{mun}/obs.json         every observation, for the record tables
data/region/IS/checklists.json     the latest 2,000 only
data/sp/{code}.json                one species across every region
data/geo/*, taxonomy.json          boundaries; the taxa recorded in Iceland
data/sci_index.json, locality_index.json    lookups for a personal import
```

**`cube.json`** is one region's records cut by species, year and month:
checklists with the species, how many of those were complete, the effort to
divide by (complete checklists per year and month), and each species' first and
last day in each year. Charts, year lists and arrival dates are all read from
it. There are 644,157 cells across the 250 regions, and `run_all.R` checks that
every one folds back to the summary beside it — per species the cells sum to its
checklist count, and the effort cells to the region's.

`summary.json` and `sp/{code}.json` are mirrored cuts of the same thing: "what
is in this region?" and "where is this species?" are each one fetch.

## Running it

```bash
Rscript R/run_all.R
```

Then:

```bash
./serve.sh
```

and open <http://127.0.0.1:8777>.

The site **must be served**, not opened from disk — browsers block `fetch()` of
local JSON over `file://`, and every view loads its data that way. Any static
host works.

`run_all.R` takes about two minutes. Steps 01 and 02 fetch from LMI and the
eBird taxonomy API and cache under `work/`, so later runs are offline unless you
delete the cache. Requires R with `auk`, `sf`, `data.table`, `jsonlite`.

To rebuild against a newer quarterly EBD, drop the new folder alongside the old
one and change `EBD_RELEASE` in `R/00_config.R`.

## Publishing

<https://sveppalicious.github.io/eBird/>

`.github/workflows/pages.yml` uploads `site/` to GitHub Pages on every push to
`main` that touches it. It is a **publish, not a build** — `run_all.R` runs on
this machine and its output is committed, so the workflow needs no R, no EBD and
no secrets. A quarterly refresh is: rebuild locally, commit `site/data/`, push.

Two things make the subpath work without configuration. Every URL in the site is
**relative** (`data/meta.json`, `css/app.css`), so the whole thing is
position-independent — moving it to a custom domain later needs no code change.
And routing is entirely in the **hash**, so the server only ever serves
`index.html`; there are no deep paths for Pages to 404 on and no rewrite rules to
write. `site/.nojekyll` stops Pages from running the content through Jekyll.

What is published: derived counts, dates, coordinates, checklist ids and eBird
observer ids — the same opaque `obsr…` identifiers eBird itself puts in profile
URLs, never names. What is not, and cannot be: the raw EBD, and any personal
export. Both are gitignored, `*.csv` is refused repo-wide, and the personal
import has no upload path at all — it is parsed in the browser and kept in
that browser's IndexedDB.

At roughly 72 MB, `site/data/` is well inside the 1 GB Pages limit — and the
cubes and summaries that make up the growth compress about six to one in
transit — but it is committed data and every rebuild adds another copy to
history. If the
repo becomes unwieldy after a few years, the fix is to publish `site/` from an
orphan branch rather than to rewrite history.

## Small screens

Most of this gets read on a phone in the field, so the layout is checked at
390 px in CI, not only by eye.

One bug there was worth the whole exercise. The top bar's content once had a
min-content width of **484 px**; on a 390 px phone Chrome responds to that by
widening the layout viewport and scaling the entire document down to fit. The
result is not a broken page — it is every page rendering at about 80% and
looking faintly soft, with no obvious cause. `tests/browser/mobile.spec.js`
asserts `innerWidth === documentElement.clientWidth` on six routes, which is the
difference between "the phone chose this width" and "the browser gave up".

Also at phone width: the map keeps its fixed, modest height whatever the shape
of the region; the first column of a wide table stays put while the rest scrolls,
so a row scrolled sideways is still identifiable; the stats become a 2×2 grid;
and charts are drawn at the size they are shown rather than scaled, so type and
bar widths stay what they were designed to be.

## Tests

```bash
npm test               # unit + data, no dependencies, ~1s
npm run test:browser   # Playwright, needs `npm ci` first
```

CI runs both on every push and pull request, and the **Pages deploy is gated on
`npm test`** — publishing is one-way, and Pages caches assets for ten minutes on
top of that, so a broken payload should not be able to reach the live site.

**CI cannot rebuild the data.** The EBD is 735 MB, licensed, and deliberately
not in the repo, so `run_all.R` is a local step. What CI can check is that the
payloads that *are* committed — the ones actually served — are internally
consistent. The build-time assertions in `run_all.R` and the data tests are
therefore two views of the same invariants, one over the tables and one over the
JSON.

| suite | what it is for | deps |
|---|---|---|
| `tests/unit/` | dates, numbers, links, the CSV reader, the region tree, the cube arithmetic, a personal import end to end, both dictionaries | none |
| `tests/data/payloads.test.js` | the committed files: the tree partitions exactly, cubes fold back to summaries, array shapes, geometry | none |
| `tests/data/hygiene.test.js` | nothing private is publishable; no third-party requests; `lib/` stays pure | none |
| `tests/browser/` | what only a real browser shows: the map, clicks, focus, the two page types at every level, an import | Playwright |

Almost every test corresponds to a bug that shipped, and says so in a comment.
The map suite leads with the three faults that prompted the rewrite: the frame
is the same height for eleven regions of very different shapes, twenty wheel
ticks change neither its height nor the position of anything below it, and every
shape's DOM node survives zooming and panning.

Three habits worth keeping. **Assert on the code point, not the appearance** —
the thousands separator was once U+202F, which renders as nothing in most fonts
and looked correct in review. **Check that a test can fail**: the map tests were
verified by making the frame's height follow the region again, and by removing
the click handler, and watching them go red. And **a test's own assumptions are
suspect too**: "the same height everywhere" was satisfied by a collapsed map of
height zero until the test also asked for a map.

## Layout

```
R/00_config.R            paths, counting rules, link builders
R/01_boundaries.R        LMI WFS -> polygons (full precision + simplified GeoJSON)
R/01b_areas.R            hverfi and postal codes x municipalities -> the fourth level
R/02_taxonomy.R          eBird taxonomy, Icelandic + English
R/03_assign_localities.R point-in-polygon, the spatial core
R/04_build_tables.R      read the EBD, roll up taxonomy, collapse shared checklists
R/05_export_json.R       export_region(): the same files for every level
R/run_all.R              all of the above, plus the conservation checks

site/index.html, css/    the shell and one stylesheet
site/js/app.js           boot, header, routing
site/js/i18n.js          Icelandic and English
site/js/lib/             pure logic, no DOM -- unit-tested under node
  format.js  csv.js  regions.js  cube.js  personal.js
site/js/data/remote.js   everyone's data: the published files
site/js/data/mine.js     your data: IndexedDB, and the same interface over it
site/js/ui/              RegionPage  SpeciesPage  MyDataPage  RegionMap
                         Charts  tables  Search  core (router, shared pieces)
site/vendor/             Leaflet, and Preact + htm -- copied in, never a CDN

serve.py / serve.sh      local static server, caching disabled
work/                    pipeline intermediates (gitignored)
```

No build step: the browser loads the modules as they are written. Preact is
there because both interface bugs that shipped in the first version — a Find box
that lost focus on every keystroke, pill highlights drifting out of step — came
from rebuilding DOM by hand.

`remote.js` and `mine.js` implement one provider interface (`summary`, `cube`,
`checklists`, `species`, `records`). If accounts are ever added, the three
storage functions in `mine.js` are where they would plug in — and that would end
the "your file never leaves this browser" promise for anyone who opted in, which
needs its own decision when the time comes.

The local server sends `Cache-Control: no-store`. That matters more than it
sounds: ES modules and JSON both cache hard, and this data is regenerated every
quarter, so without it a rebuild appears to change nothing.

## How the numbers are counted

Matching eBird's own rules, so the totals are comparable:

- **Subspecies roll up to the species.** The EBD already puts the parent
  binomial in `SCIENTIFIC NAME` (`issf`, `form`, `domestic` rows all do this), so
  "does this count as a species?" reduces to whether that name matches a taxon
  whose category is `species`. `spuh`, `slash` and `hybrid` rows carry names that
  are not binomials (`Anser fabalis/serrirostris`, `Anas platyrhynchos x acuta`)
  and so fall out naturally. They are kept in the data, listed unnumbered below
  the species, exactly as eBird does.
- **Escapees don't count.** `EXOTIC CODE = X` is excluded; `N` (naturalised) and
  `P` (provisional) count. Countability is per record, not per species: seven
  taxa (Mute Swan, Eurasian Kestrel, Graylag Goose, Mallard, Mandarin Duck,
  Carrion Crow, Black Kite) have escapee and wild records side by side. One
  countable record makes the taxon countable in that sveitarfélag.
- **Shared checklists count once.** 44,397 of 280,208 submissions are duplicate
  copies of a group outing. One canonical submission is kept per group, so that
  every row still links to a real `ebird.org/checklist/S…` page.
- **Unvetted records are excluded**, matching what eBird itself publishes. The
  main EBD file is `APPROVED = 1` throughout; a separate 43 KB file holds **91
  records** — 0.0045% of the 2,002,096 vetted ones — all flagged
  `APPROVED = 0, REVIEWED = 0`, meaning *awaiting review* rather than rejected.
  They are 61 taxa across 90 checklists, overwhelmingly rarities under
  consideration: Common Pochard, Black Tern, Sabine's Gull, Common Crane. eBird
  does not show these on a region's bird list either, so including them would
  make this site disagree with the source it is checked against. Flip
  `INCLUDE_UNVETTED` in `R/00_config.R` to fold them in.

## Links back to eBird

| Column | Target |
|---|---|
| species | a local page scoped to the municipality, plus an "open in eBird" link scoped to the parent region |
| date | `ebird.org/checklist/{SAMPLING EVENT IDENTIFIER}` |
| observer | `ebird.org/profile/{base64 of the numeric id}/world` |
| location | `ebird.org/hotspot/{LOCALITY ID}` — hotspots only |

Two of these have caveats worth knowing:

- **Species links cannot be municipality-scoped.** Municipalities are not eBird
  regions, so no such URL exists. The parent region (IS-1 …) is as close as eBird
  gets; the municipality-scoped view is the local page.
- **Observer profile encoding is only partly confirmed.** The one verified
  example (`obsr113578` → `MTEzNTc4`) is 6 digits, the single length whose base64
  needs no padding. 7-digit ids encode with a trailing `==`, and eBird's pages
  redirect to login when signed out, so that case could not be checked. Standard
  base64 keeps the padding and that is what is emitted. If a padded link fails
  while a 6-digit one works, set `STRIP_BASE64_PADDING = true` in
  `site/js/format.js` — it is the only place it is used.

**Observer names are not in the EBD.** eBird strips them, so eBirders appear as
`obsrNNNNNN`, hyperlinked to their profile.

## How good is the geometry?

Of the 40,770 localities:

| | localities | checklists | |
|---|---:|---:|---|
| inside a polygon | 36,548 | 232,947 | 83.1% |
| within 2 km | 2,681 | 43,943 | 15.7% — harbours, coastal jitter, shoreline generalisation |
| 2–30 km | 911 | 2,496 | 0.9% — whale-watching, bird islands, ferry legs; assigned to the nearest municipality and flagged |
| beyond 30 km | 630 | 822 | 0.3% — collected under a pseudo-municipality, **Hafsvæði** |

**Cross-check.** Each sveitarfélag sits in exactly one eBird region, and eBird
already labels every checklist with its region. Comparing the two,
**314 of 40,140 localities disagree — 0.78%**. The largest cluster (206
localities) is the west shore of Hrútafjörður, which LMI puts in Húnaþing vestra
while eBird calls it Vestfirðir: a real disagreement between the two authorities,
not a placement error. LMI is authoritative on municipalities.

**Against eBird's published totals.** Aggregating back up to IS-1 gives **221
species** where eBird's site showed **224** on 25 Jul 2026 — the expected small
shortfall, since this EBD is the June 2026 release and ends 30 Jun 2026.

## Known limits

- **Traveling and pelagic checklists carry one coordinate for a whole route**, so
  a route crossing a boundary is attributed entirely to that point's
  municipality. The Vestmannaeyjar ferry is the clearest case. Municipalities
  where this is more than 2% of checklists say so on the page.
- **Municipality boundaries change.** The pipeline refetches from LMI each run
  and keys on the official `nrsveitarfelags`; a merger between runs changes
  slugs. `meta.json` records the LMI dataset version.
- **Frequency needs complete checklists.** Before about 2010 most region-years
  have too few to carry one. Those years are drawn pale and flagged, never
  hidden — but a pale bar is a statement about the birders, not the birds.
- **Arrival dates lean on effort too.** More observers find a migrant sooner, so
  an earlier first date over the years is partly eBird's growth. The chart says
  so; it is a prompt to look, not a measurement.
- **Media is not split into photo vs audio**, and is not shown: `HAS MEDIA` is a
  single flag.

## Data

The EBD is a **monthly snapshot, not a live feed** — published on the 15th, each
release ending with the previous month. The site says so on the front page and
in every footer, because otherwise a birder who cannot find last week's rarity
concludes the site is broken rather than out of date. The cut-off shown is read
from `meta.dateRange[1]`, not written into the text, so it stays true after
every rebuild; today it reads 30 Jun 2026.

eBird Basic Dataset. Version: EBD_relJun-2026. Cornell Lab of Ornithology,
Ithaca, New York. Jun 2026. Used under the
[eBird terms of use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/).

Municipality boundaries: IS 50V, Landmælingar Íslands, CC BY 4.0.

Species names and codes: eBird/Clements taxonomy via the eBird API.
