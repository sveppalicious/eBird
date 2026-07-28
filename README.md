# eBird Ísland — sveitarfélög

eBird exposes three sub-national levels for Denmark but only two for Iceland:
country → landshluti (IS-1 … IS-8) → nothing. This project adds the missing
level, **sveitarfélög (municipalities)**, with a Bird List, a species page and a
checklist browser for each of them.

It works in both directions:

| Route | View |
|---|---|
| `#/` | Iceland choropleth by species richness; click a sveitarfélag to drill in |
| `#/mun/{slug}` | that sveitarfélag's Bird List, with a zoomed map whose neighbours stay clickable |
| `#/mun/{slug}/checklists` | its checklist browser |
| `#/mun/{slug}/species/{code}` | every record of one taxon there |
| `#/mun/{slug}/areas` | **its hverfi or póstnúmer** — the fourth level, where one exists |
| `#/mun/{slug}/area/{code}` | one area's Bird List, checklists and species pages |
| `#/species` | every taxon recorded in Iceland, searchable |
| `#/species/{code}` | **which sveitarfélög that taxon has been found in**, as a choropleth plus a table |
| `#/me` | upload your own eBird export and see it on the same map |

## Your own data

`#/me` takes the `MyEBirdData.csv` from
[ebird.org/downloadMyData](https://ebird.org/downloadMyData) and places your
records in sveitarfélög: which ones you have birded, how many species you have
in each against how many have been recorded there, and — on every sveitarfélag's
Bird List — a **✓ against species you have seen** plus a **"Not seen here"**
filter, which is the list of what you still need.

Once a file is loaded, every map gains a **Show: All eBirders / Mín gögn**
switch, and the headline figures follow it — on a sveitarfélag that means
*My species · My checklists · Coverage · Recorded here* rather than the
all-eBirders totals. The setting persists, and following a municipality link out
of `#/me` selects "Mín gögn" for you, so drilling in from your own map does not
dump you back into everyone else's numbers.

**In "Mín gögn" the Bird List becomes your life list for that region**, the way
eBird's own life list works. It opens filtered to your species; the rows are
your sightings — your count, your date linking to your checklist, your locality;
Last/First Observed sort by **your** dates rather than by when anyone else last
saw the bird; and the row number is your life-list ordinal there, 1 being the
first species you ever recorded in that sveitarfélag or hverfi. Sorted by First
Observed the numbers count cleanly down, which needs taxonomic order as a
tiebreak — a single morning often adds several species on the same date.

The observer and ✓ columns disappear in that view: the observer is always you
and every row is ticked, and eBird's life list shows neither. Switch to **Not
seen here** and both come back, because those rows are other people's records
and who found the bird is the useful part — that is the needs list. The
Checklists tab gains the same switch and defaults to your own visits.

**Your localities are drawn on every map** while Mín gögn is on, sized by how
often you have birded each — the choropleth says which sveitarfélag you have
covered, the dots say where you actually stood. Hover one for its checklist and
species count, or hide them with **◍ Mínir staðir**.

The **species page** takes the same switch: `#/species/{code}` in Mín gögn
becomes your own range map for that taxon — the sveitarfélög you have it in
shaded by your checklist count, dots at the places you saw it, and a table of
your first and last sighting in each.

**The file never leaves your browser.** It is read with the FileReader API,
parsed by JavaScript on the page, and reduced to per-municipality species
counts. There is no server to upload it to; the site is static files. If you
keep it, it goes to that browser's `localStorage` on that device alone, and
"Remove my data" erases it. An eBird export is a detailed history of where
somebody has been and when — the design treats it that way.

Two quirks of the personal export that the importer handles, and that a naive
reader gets wrong:

- **Rows are ragged.** eBird drops trailing empty fields rather than padding, so
  a 23-column header is followed by rows of 16 to 23 fields. Requiring
  full-width rows silently discards ~98% of the file.
- **It names the sub-taxon.** `Scientific Name` holds `Anser anser anser` or
  `Columba livia (Feral Pigeon)` where the EBD holds the parent binomial, so a
  plain join matches only about 80% of taxa. `sci_index.json` maps every
  taxonomy name to its reportable species, and carries that species' category so
  spuh/slash/hybrid entries are not miscounted as species.

Localities are matched by eBird Location ID against `locality_index.json`
(361 of 372 in a real export), and anything left — records newer than the EBD
release — is placed by testing its coordinates against the boundaries in the
browser.

Verified against a real export: the importer reproduces eBird's own figures
exactly — **105 species and 677 checklists** for Iceland, and **83 species over
289 checklists** for Höfuðborgarsvæði, matching that account's eBird pages.

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

The level costs almost nothing to serve: the area is a column on
`checklists.json`, and `obs.json` already indexes into the checklists, so area
pages are computed in the browser from payloads the municipality view has
loaded anyway — no per-area files. URLs use a name slug where there is a name
(`/area/midborg`) and the number otherwise (`/area/640`).

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
clickable, so the municipality has to list them: sourcing `area_ids` from the
observed checklists instead left 806 in Grímsnes- og Grafningshreppur drawn but
absent from `summary.json`, which hid the Póstnúmer tab and made its polygon a
link to "No such póstnúmer here". `run_all.R` now asserts that every built area
is listed by its municipality.

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
`localStorage`.

At roughly 48 MB, `site/data/` is well inside the 1 GB Pages limit, but it is
committed data and every quarterly rebuild adds another copy to history. If the
repo becomes unwieldy after a few years, the fix is to publish `site/` from an
orphan branch rather than to rewrite history.

## Tests

```bash
npm test           # unit + data, no dependencies, ~1s
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
| `tests/unit/` | dates, numbers, eBird links, the CSV reader, Mercator arithmetic | none |
| `tests/data/` | the committed payloads: tiling, ids, array shapes, geometry | none |
| `tests/data/hygiene.test.js` | nothing private is publishable; the site stays self-contained | none |
| `tests/browser/` | what only a real browser shows: clicks, focus, panning | Playwright |

Almost every test corresponds to a bug that shipped, and says so in a comment.
The split is not arbitrary: **roughly half this project's bugs were invisible to
any test that does not drive a browser**, and the other half were invisible to
any test that does. A pointer-capture bug made the whole map unclickable while
hover, tooltips and the cursor all still worked; an area missing from
`summary.json` was a dead link nobody would click by hand. Only one kind of
suite catches each.

Two habits worth keeping. **Assert on the code point, not the appearance** —
the thousands separator was once U+202F, which renders as nothing in most fonts
and looked correct in review. And **check that a test can fail**: both
regression tests above were verified by reintroducing the bug and watching them
go red, which is the only evidence that a green suite means anything.

## Layout

```
R/00_config.R            paths, counting rules, link builders
R/01_boundaries.R        LMI WFS -> polygons (full precision + simplified GeoJSON)
R/01b_areas.R            postal codes x municipalities -> the fourth level
R/02_taxonomy.R          eBird taxonomy, Icelandic + English
R/03_assign_localities.R point-in-polygon, the spatial core
R/04_build_tables.R      read the EBD, roll up taxonomy, collapse shared checklists
R/05_export_json.R       write site/data/
R/run_all.R              all of the above, plus the conservation checks

serve.py / serve.sh      local static server, caching disabled
site/                    the static site; vanilla JS, no build step, no CDN
work/                    intermediates (gitignored)
```

`site/data/` holds two mirrored cuts of the same data: `mun/{slug}/` answers
"what is in this sveitarfélag?" and `sp/{code}.json` answers "where is this
taxon?". Either question is one fetch. `sci_index.json` and
`locality_index.json` exist only to match a user's own export against the two.

The local server sends `Cache-Control: no-store`. That matters more than it
sounds: ES modules and JSON both cache hard, and this data is regenerated every
quarter, so without it a rebuild appears to change nothing.

## Maps

`site/js/map.js` is a small map engine rather than a static picture, with no
dependency — no Leaflet, no CDN.

Geometry is projected into a **Web Mercator** world square once and drawn once.
Panning and zooming only move the SVG `viewBox`, so dragging a 61-polygon
country map costs nothing; only the tiles and the point radii are recomputed.
Scroll to zoom about the cursor, drag to pan, **⤢ Endurstilla** to return.

Mercator is what makes an optional basemap possible without a mapping library: a
slippy tile `(x, y, z)` occupies exactly `WORLD/2^z` units at `WORLD·x/2^z`, so
tiles need no reprojection — just `<image>` elements placed in world coordinates.

**A basemap is off by default, and that is deliberate.** With **Ekkert**
selected the page requests nothing but its own files, which is what keeps the
site self-contained and usable offline. Turning on **Kort** (OpenStreetMap) or
**Gervihnöttur** (Esri World Imagery) starts fetching tiles from a third party
at runtime; both are attributed in the corner as their terms require, and the
choice persists. Over imagery the choropleth drops to a **22% wash** and its
hairlines darken to carry the boundaries on their own: with a basemap on, the
point is the ground, and hover leans on opacity rather than brightness because
brightness barely reads that pale.

Two traps worth recording, both found the same way — a real click in a real
browser, not a dispatched event.

**Pointer capture eats the click.** Taking `setPointerCapture` on `pointerdown`
is the obvious way to keep a drag alive outside the element, and it silently
killed every polygon click on the map: capture retargets the following `click`
to the capture element, so it arrived at the `<svg>` and the paths' own handlers
never ran — `pointerdown` still hit the path, which is what makes it so
confusing to read. Capture is now taken only once the pointer has moved past 4
px, so an ordinary click never sets it and reaches the polygon normally.

**`requestAnimationFrame` is suspended in a background tab.** The first draw
used to run inside one, so opening the site in a background tab left the points
with no radius and the tiles undrawn. It now draws synchronously and redraws
from a `ResizeObserver`, which fires on layout rather than paint and doubles as
the window-resize handler, since the tile zoom depends on pixel width.

Wheel handling sits on the frame rather than the `<svg>`: the control bar floats
over the map and covers a good part of it on a phone, where a wheel used to fall
through and scroll the page instead of zooming.

**Your locality dots are never filtered to the selected sveitarfélag.** A zoomed
map still draws its neighbours, and cutting their dots made places you have
birded plenty look untouched — the same mistake as colouring neighbours grey.
The viewBox does the clipping. Because the dots sit above the polygons and cover
the capital thickly, a click on one selects the polygon underneath rather than
landing on nothing; the hit test works on either layer, since each path carries
its own id. The species map is the one exception that *does* filter, to the
localities where you recorded that taxon.

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
- **Media is not split into photo vs audio.** `HAS MEDIA` is a single flag, so
  the tile reads "species w/ media" rather than mimicking eBird's two counters.

## Data

The EBD is a **monthly snapshot, not a live feed** — published on the 15th, each
release ending with the previous month. The site says so on the front page and
in every footer, because otherwise a birder who cannot find last week's rarity
concludes the site is broken rather than out of date. The cut-off shown is read
from `meta.dateRange[1]`, not written into the text, so it stays true after
every rebuild; today it reads 30 Jun 2026.

Two smaller notes on the front end. **Controls are built once, outside the
redraw.** Rebuilding them on each keystroke destroyed the `<input>` being typed
into, so the Find boxes on the species and checklist pages took one character
per click before losing focus. And the **ÍS/EN switch** changes the primary
species name, so it has no visible effect on pages that show no species names —
the front map and the checklist browser.

eBird Basic Dataset. Version: EBD_relJun-2026. Cornell Lab of Ornithology,
Ithaca, New York. Jun 2026. Used under the
[eBird terms of use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/).

Municipality boundaries: IS 50V, Landmælingar Íslands, CC BY 4.0.

Species names and codes: eBird/Clements taxonomy via the eBird API.
