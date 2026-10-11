# 05_export_json.R -- write the static payloads the site reads.
#
# One concept, three levels. Iceland, each sveitarfelag and each hverfi or
# postnumer is a *region*, and every region gets the same files from the same
# writer -- which is what lets the site show the same page at every level.
#
# Layout under site/data/:
#   meta.json                      release, date range, totals
#   regions.json                   the tree: id, parent, kind, name, headline stats
#   taxonomy.json                  only the taxa that occur in Iceland
#   geo/                           written by 01_boundaries.R and 01b_areas.R
#   region/<id>/summary.json       stats + one row per species (all years)
#   region/<id>/cube.json          species x year x month counts, with effort
#   region/<mun>/checklists.json   the checklist browser (areas reuse their parent's)
#   region/<mun>/obs.json          every observation, for the record tables
#   region/IS/checklists.json      the most recent few thousand only
#   sp/<code>.json                 one species across every region
#
# cube.json is what makes charts, year lists and arrival dates work at every
# level without the browser downloading observations. Everything bulky is
# columnar with integer dictionaries.

source("R/00_config.R")

suppressPackageStartupMessages({
  library(data.table)
  library(jsonlite)
})

COUNTRY_ID   <- "IS"
COUNTRY_NAME <- "Ísland"
# 235k checklists is far too many to hand a browser for the national view.
COUNTRY_CHECKLISTS <- 2000L
# How many of a species' latest records travel with its file, for the national
# species page where the full list would be every observation in the country.
RECENT_RECORDS <- 50L

obs <- readRDS(file.path(WORK_DIR, "obs_mun.rds"))
chk <- readRDS(file.path(WORK_DIR, "checklists_mun.rds"))
tax <- readRDS(file.path(WORK_DIR, "taxonomy.rds"))
mun <- data.table::as.data.table(
  sf::st_drop_geometry(readRDS(file.path(WORK_DIR, "sveitarfelog.rds"))))
locmun <- readRDS(file.path(WORK_DIR, "locality_municipality.rds"))
area_meta <- data.table::as.data.table(
  sf::st_drop_geometry(readRDS(file.path(WORK_DIR, "areas.rds"))))

write_json_min <- function(x, path) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, na = "null",
                       digits = 6, null = "null")
}

# auto_unbox is what keeps scalars like `"id": "0000-..."` from being written
# as one-element arrays -- but it applies to *every* length-1 vector, so a
# region with a single checklist would emit `"y": 2019` instead of `"y": [2019]`
# and every consumer indexing it as an array silently gets undefined. Wrap
# anything that must stay an array in arr().
arr <- function(x) I(unname(x))

# ---- region names, straight from the EBD ------------------------------------

msg("Reading region names")
region_names <- data.table::fread(
  EBD_SAMPLING_FILE, select = c("STATE", "STATE CODE"),
  col.names = c("state", "code"), quote = "", showProgress = FALSE,
  encoding = "UTF-8", nThread = 4
)
region_names <- unique(region_names)[code != "" & code != "IS-"]
data.table::setkey(region_names, code)
region_map <- stats::setNames(region_names$state, region_names$code)

# ---- taxonomy subset --------------------------------------------------------

used <- obs[, unique(sci)]
tax_used <- tax[sci %chin% used]
data.table::setorder(tax_used, taxonOrder)
write_json_min(
  tax_used[, .(c = speciesCode, sci, en, is, ord = taxonOrder,
               cat = category, fam = family, hasIs = has_is)],
  file.path(DATA_DIR, "taxonomy.json")
)
msg("  taxonomy.json: ", nrow(tax_used), " taxa recorded in Iceland")

# ---- shared preparation -----------------------------------------------------

nsp <- obs[, .(nsp = .N), by = sub]
chk <- merge(chk, nsp, by = "sub", all.x = TRUE)
chk[is.na(nsp), nsp := 0L]
chk[, complete := as.integer(complete)]

# Frequency is "complete checklists with the species / complete checklists",
# so every observation needs to know whether its checklist was complete.
obs[chk, comp := i.complete, on = "sub"]
stopifnot(!anyNA(obs$comp))
# The cube counts rows as checklists; that only holds while a checklist lists a
# species at most once, which the rollup in step 04 is meant to guarantee.
stopifnot(nrow(obs) == data.table::uniqueN(obs, by = c("sub", "speciesCode")))

# Newest first, so any subset of checklists is already in browsing order; and
# species then date, so the first and last row of a species group are its first
# and last record and gzip sees long runs.
data.table::setorder(chk, -date, sub)
data.table::setorder(obs, taxonOrder, speciesCode, date, sub)

# Start clean: a region or species that has disappeared since the last build
# must not linger as a file the site can still reach.
SP_DIR <- file.path(DATA_DIR, "sp")
unlink(REGION_DIR, recursive = TRUE)
unlink(SP_DIR, recursive = TRUE)
unlink(file.path(DATA_DIR, "mun"), recursive = TRUE)        # pre-rewrite layout
unlink(file.path(DATA_DIR, "species_index.json"))
dir.create(REGION_DIR, recursive = TRUE)
dir.create(SP_DIR, recursive = TRUE)

# ---- pieces of one region ---------------------------------------------------

# One row per species, with the row numbers of its first, last and highest-count
# record. Row numbers rather than values, so the three records can be read back
# out of the same table without three more passes.
species_agg <- function(oo) {
  if (!nrow(oo)) return(NULL)
  oo[, {
    ih <- if (all(is.na(count))) .N else which.max(count)
    .(k  = .N,
      kc = sum(comp),
      # Countability is per record, not per species: escapee (EXOTIC CODE = X)
      # sightings sit alongside wild ones for Mute Swan, Eurasian Kestrel,
      # Graylag Goose and four others. One countable record makes the species
      # countable here, which is how the headline species total is computed too.
      x  = as.integer(any(countable)),
      fi = .I[1L], la = .I[.N], hi = .I[ih])
  }, by = speciesCode]
}

# The three records eBird surfaces. Each carries everything the hyperlinks in
# the table need: checklist, observer, locality and whether it is a hotspot.
record_at <- function(oo, i) list(
  d  = as.integer(oo$date[i]), s = oo$sub[i], b = oo$obsr[i],
  l  = oo$loc_id[i], ln = oo$loc_name[i], lt = oo$loc_type[i],
  n  = if (is.na(oo$count[i])) NULL else as.integer(oo$count[i])
)

region_stats <- function(co, oo, agg) list(
  species      = if (is.null(agg)) 0L else sum(agg$x),
  taxa         = if (is.null(agg)) 0L else nrow(agg),
  checklists   = nrow(co),
  complete     = sum(co$complete),
  observations = nrow(oo),
  observers    = data.table::uniqueN(co$obsr),
  localities   = data.table::uniqueN(co$loc_id),
  media        = data.table::uniqueN(oo[has_media == 1L]$speciesCode),
  # Almost every coastal municipality has *some* offshore locality, so a bare
  # any() would tag nearly all of them and mean nothing. Report the count and
  # let the UI decide what is worth flagging.
  offshoreChecklists = sum(co$offshore),
  firstDate    = if (nrow(co)) as.integer(min(co$date)) else NULL,
  lastDate     = if (nrow(co)) as.integer(max(co$date)) else NULL
)

write_summary <- function(dir, id, stats, agg, oo) {
  rows <- if (is.null(agg)) list() else lapply(seq_len(nrow(agg)), function(i) list(
    c = agg$speciesCode[i], k = agg$k[i], kc = agg$kc[i], x = agg$x[i],
    first = record_at(oo, agg$fi[i]),
    last  = record_at(oo, agg$la[i]),
    high  = record_at(oo, agg$hi[i])
  ))
  write_json_min(list(id = id, stats = stats, species = arr(rows)),
                 file.path(dir, "summary.json"))
}

# Species x year x month, plus the effort it has to be divided by. `n` counts
# every checklist with the species, `c` only complete ones; `en`/`ec` are the
# same two counts for all checklists in the region that month.
write_cube <- function(dir, id, co, oo, agg) {
  codes <- if (is.null(agg)) character() else agg$speciesCode
  if (nrow(oo)) {
    cube <- oo[, .(n = .N, c = sum(comp)), by = .(speciesCode, year, month)]
    cube[, si := match(speciesCode, codes) - 1L]
    data.table::setorder(cube, si, year, month)
    # First and last day of each species in each year: the year list's dates,
    # and the raw material for arrival dates.
    yr <- oo[, .(f = as.integer(min(date)), l = as.integer(max(date))),
             by = .(speciesCode, year)]
    yr[, si := match(speciesCode, codes) - 1L]
    data.table::setorder(yr, si, year)
  } else {
    cube <- data.table::data.table(si = integer(), year = integer(),
                                   month = integer(), n = integer(), c = integer())
    yr <- data.table::data.table(si = integer(), year = integer(),
                                 f = integer(), l = integer())
  }
  eff <- co[, .(n = .N, c = sum(complete)), by = .(year, month)]
  data.table::setorder(eff, year, month)

  write_json_min(list(
    id  = id,
    sp  = arr(codes),
    si  = arr(cube$si), y = arr(cube$year), m = arr(cube$month),
    n   = arr(cube$n),  c = arr(cube$c),
    ysi = arr(yr$si), yy = arr(yr$year), yf = arr(yr$f), yl = arr(yr$l),
    ey  = arr(eff$year), em = arr(eff$month), en = arr(eff$n), ec = arr(eff$c)
  ), file.path(dir, "cube.json"))
  nrow(cube)
}

# The checklist browser, and the dictionary obs.json indexes into. `area_ids`
# lets an area page filter its parent's file instead of having one of its own;
# `regs` does the same job for the national file, where a location name means
# little without its sveitarfelag.
write_checklists <- function(dir, id, co, area_ids = NULL, total = nrow(co)) {
  locs <- unique(co[, .(loc_id, loc_name, loc_type)])
  data.table::setorder(locs, loc_id)
  obsrs  <- sort(unique(co$obsr))
  protos <- sort(unique(co$protocol))

  out <- list(
    id     = id,
    total  = total,
    locs   = list(id = arr(locs$loc_id), name = arr(locs$loc_name),
                  type = arr(locs$loc_type)),
    obsrs  = arr(obsrs),
    protos = arr(protos),
    sub    = arr(co$sub),
    date   = arr(as.integer(co$date)),
    time   = arr(co$time),
    loc    = arr(match(co$loc_id, locs$loc_id) - 1L),
    obsr   = arr(match(co$obsr, obsrs) - 1L),
    proto  = arr(match(co$protocol, protos) - 1L),
    dur    = arr(co$duration),
    dist   = arr(co$distance),
    nobsr  = arr(co$n_observers),
    comp   = arr(co$complete),
    nsp    = arr(co$nsp),
    shared = arr(as.integer(co$n_submissions > 1L))
  )
  if (!is.null(area_ids)) {
    out$areas <- arr(area_ids)
    # -1 where the checklist is outside every area (cannot happen inside a
    # municipality today, but the browser tests `>= 0` rather than trusting it).
    out$area  <- arr(data.table::fifelse(is.na(co$area_id), -1L,
                                         match(co$area_id, area_ids) - 1L))
  } else {
    regs <- sort(unique(co$mun_slug))
    out$regs <- arr(regs)
    out$reg  <- arr(match(co$mun_slug, regs) - 1L)
  }
  write_json_min(out, file.path(dir, "checklists.json"))
}

# Every observation, columnar. `k` indexes the checklists file written beside
# it; `n` is null where the observer reported "X" (present, uncounted).
write_obs <- function(dir, id, co, oo, agg) {
  codes <- if (is.null(agg)) character() else agg$speciesCode
  write_json_min(list(
    id = id,
    sp = arr(codes),
    si = arr(match(oo$speciesCode, codes) - 1L),
    k  = arr(match(oo$sub, co$sub) - 1L),
    n  = arr(oo$count),
    # media is rare, so ship the indices that have it rather than a full column
    media = arr(which(oo$has_media == 1L) - 1L)
  ), file.path(dir, "obs.json"))
}

# ---- the writer -------------------------------------------------------------

# Everything a region page needs, for any level. Returns the headline stats for
# regions.json and the per-species rows that the species files are built from.
export_region <- function(id, co, oo, full = FALSE, area_ids = NULL) {
  dir <- file.path(REGION_DIR, id)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)

  agg <- species_agg(oo)
  stats <- region_stats(co, oo, agg)
  write_summary(dir, id, stats, agg, oo)
  cells <- write_cube(dir, id, co, oo, agg)
  if (full) {
    write_checklists(dir, id, co, area_ids = area_ids)
    write_obs(dir, id, co, oo, agg)
  }

  per_species <- if (is.null(agg)) NULL else data.table::data.table(
    id = id, c = agg$speciesCode, k = agg$k, kc = agg$kc,
    fi = agg$fi, la = agg$la, hi = agg$hi
  )
  # Resolve the three records now, while `oo` is in hand: the species files are
  # written later, from every region at once.
  if (!is.null(per_species)) {
    for (w in c("fi", "la", "hi")) {
      ix <- per_species[[w]]
      p <- substr(w, 1, 1)
      per_species[, paste0(p, c("d", "s", "b", "l", "ln", "lt", "n")) := list(
        as.integer(oo$date[ix]), oo$sub[ix], oo$obsr[ix], oo$loc_id[ix],
        oo$loc_name[ix], oo$loc_type[ix], oo$count[ix])]
    }
    per_species[, c("fi", "la", "hi") := NULL]
  }
  list(stats = stats, species = per_species, cells = cells)
}

# ---- run: Iceland, then each sveitarfelag, then each area --------------------

regions <- list()
species_rows <- list()
cube_cells <- 0L

add_region <- function(info, res) {
  regions[[length(regions) + 1L]] <<- c(info, res$stats)
  species_rows[[length(species_rows) + 1L]] <<- res$species
  cube_cells <<- cube_cells + res$cells
}

msg("Exporting ", COUNTRY_NAME)
res <- export_region(COUNTRY_ID, chk, obs)
write_checklists(file.path(REGION_DIR, COUNTRY_ID), COUNTRY_ID,
                 chk[seq_len(min(COUNTRY_CHECKLISTS, nrow(chk)))],
                 total = nrow(chk))
add_region(list(id = COUNTRY_ID, parent = NULL, kind = "country",
                name = COUNTRY_NAME, code = COUNTRY_ID, ebird = COUNTRY_ID), res)

chk_by_mun <- split(seq_len(nrow(chk)), chk$mun_slug)
obs_by_mun <- split(seq_len(nrow(obs)), obs$mun_slug)
slugs <- sort(names(chk_by_mun))
msg("Exporting ", length(slugs), " sveitarfelog")

for (i in seq_along(slugs)) {
  s <- slugs[i]
  if (i %% 10 == 0) msg("  ", i, "/", length(slugs))
  co <- chk[chk_by_mun[[s]]]
  oo <- obs[obs_by_mun[[s]]]
  # Every area of this municipality, including any that hold no checklists yet:
  # the map draws them and makes them clickable, so they have to exist.
  area_ids <- sort(area_meta[slug == s]$area_id)
  res <- export_region(s, co, oo, full = TRUE, area_ids = area_ids)

  m <- mun[slug == s]
  sea <- s == OPEN_SEA_SLUG
  add_region(list(
    id = s, parent = COUNTRY_ID,
    # Hafsvaedi is not a municipality: it collects the checklists more than
    # 30 km from any of them, so they are kept rather than dropped.
    kind = if (sea) "sea" else "sveitarfelag",
    name = if (nrow(m)) m$name else OPEN_SEA_NAME,
    code = s,
    nr = if (nrow(m)) m$nr else NULL,
    areaKm2 = if (nrow(m)) m$area_km2 else NULL,
    # A sveitarfelag is not an eBird region, so links out to eBird scope to the
    # landshluti that contains it.
    ebird = co$region[1],
    ebirdName = unname(region_map[co$region[1]])
  ), res)
}

chk_by_area <- split(seq_len(nrow(chk)), chk$area_id)
obs_by_area <- split(seq_len(nrow(obs)), obs$area_id)
data.table::setorder(area_meta, slug, code)
msg("Exporting ", nrow(area_meta), " hverfi and postnumer")

for (i in seq_len(nrow(area_meta))) {
  a <- area_meta[i]
  if (i %% 40 == 0) msg("  ", i, "/", nrow(area_meta))
  co <- chk[if (is.null(chk_by_area[[a$area_id]])) integer() else chk_by_area[[a$area_id]]]
  oo <- obs[if (is.null(obs_by_area[[a$area_id]])) integer() else obs_by_area[[a$area_id]]]
  res <- export_region(a$area_id, co, oo)
  add_region(list(
    id = a$area_id, parent = a$slug, kind = a$kind,
    name = a$label, code = a$code, areaKm2 = a$area_km2,
    ebird = chk[mun_slug == a$slug]$region[1]
  ), res)
}

write_json_min(list(regions = arr(regions)), file.path(DATA_DIR, "regions.json"))
msg("  regions.json: ", length(regions), " regions, ",
    format(cube_cells, big.mark = ","), " cube cells")

# ---- lookups for matching a user's own eBird export -------------------------
# The "Download my data" CSV differs from the EBD in two ways that matter, so
# the browser needs help with both:
#
#   1. It reports the sub-taxon in Scientific Name ("Anser anser anser",
#      "Columba livia (Feral Pigeon)") where the EBD puts the parent binomial.
#      Joining on Scientific Name alone matched only 122 of 147 taxa in a real
#      export. sci_index maps every taxonomy name to its reportable species.
#   2. It has no County, like the EBD, so localities need placing. 361 of 372
#      localities in that export were already in the EBD, so shipping the
#      locality index avoids point-in-polygon for ~97% of them; the browser
#      falls back to a polygon test for the rest.

msg("Exporting lookups for personal-data matching")

# reportAs points straight at the reportable parent -- verified no chains.
tax_all <- data.table::copy(tax)
tax_all[, resolved := data.table::fifelse(is.na(reportAs), speciesCode, reportAs)]

# Carry the resolved taxon's *category* too. Without it the browser has to look
# the category up in taxonomy.json, which only holds the taxa recorded in
# Iceland -- so a species a user has seen but that is not in this EBD yet (a
# pending rarity, or one found after the cut-off) would be dropped from their
# species count with no sign. A real export contained exactly that: American
# Tree Sparrow, the difference between 104 and the 105 eBird showed them.
cat_by_code <- stats::setNames(tax_all$category, tax_all$speciesCode)
tax_all[, resolved_cat := unname(cat_by_code[resolved])]

write_json_min(list(
  sci  = arr(tax_all$sci),
  code = arr(tax_all$resolved),
  cat  = arr(tax_all$resolved_cat)
), file.path(DATA_DIR, "sci_index.json"))
msg("  sci_index.json: ", nrow(tax_all), " names -> reportable species")

# Locality -> municipality, as the site already resolved it. Slugs are indexed
# so the file stays small. `type` travels too: the personal export says nothing
# about whether a locality is a hotspot, and without that the site cannot
# decide which of a user's own localities get an ebird.org/hotspot link.
loc_slugs <- sort(unique(locmun$mun_slug))
loc_areas <- sort(unique(stats::na.omit(locmun$area_id)))
write_json_min(list(
  slugs = arr(loc_slugs),
  areas = arr(loc_areas),
  id    = arr(locmun$loc_id),
  mun   = arr(match(locmun$mun_slug, loc_slugs) - 1L),
  # -1 where the locality is outside every postal area (open sea).
  area  = arr(data.table::fifelse(is.na(locmun$area_id), -1L,
                                  match(locmun$area_id, loc_areas) - 1L)),
  type  = arr(locmun$loc_type)
), file.path(DATA_DIR, "locality_index.json"))
msg("  locality_index.json: ", nrow(locmun), " localities")

# ---- per-species: one taxon across every region ------------------------------
# The mirror image of summary.json, so a species page is one fetch rather than
# a read of every region's summary.

all_species <- data.table::rbindlist(species_rows, use.names = TRUE)
msg("Exporting ", data.table::uniqueN(all_species$c), " species")

# Newest records nationally, for the country-level species page.
data.table::setorder(obs, speciesCode, -date, sub)
recent <- obs[, utils::head(.SD, RECENT_RECORDS), by = speciesCode,
              .SDcols = c("date", "sub", "obsr", "loc_id", "loc_name",
                          "loc_type", "count", "mun_slug")]

rec_from <- function(r, p) list(
  d = r[[paste0(p, "d")]], s = r[[paste0(p, "s")]], b = r[[paste0(p, "b")]],
  l = r[[paste0(p, "l")]], ln = r[[paste0(p, "ln")]], lt = r[[paste0(p, "lt")]],
  n = if (is.na(r[[paste0(p, "n")]])) NULL else r[[paste0(p, "n")]]
)

sp_split <- split(all_species, by = "c")
recent_split <- split(recent, by = "speciesCode")
for (code in names(sp_split)) {
  d <- sp_split[[code]]
  # Iceland first, then busiest first, so the client can take the head.
  d <- d[order(id != COUNTRY_ID, -k)]
  rr <- recent_split[[code]]
  write_json_min(list(
    c = code,
    regions = arr(lapply(seq_len(nrow(d)), function(i) {
      r <- as.list(d[i])
      list(id = r$id, k = r$k, kc = r$kc,
           first = rec_from(r, "f"), last = rec_from(r, "l"), high = rec_from(r, "h"))
    })),
    recent = arr(lapply(seq_len(nrow(rr)), function(i) list(
      d = as.integer(rr$date[i]), s = rr$sub[i], b = rr$obsr[i],
      l = rr$loc_id[i], ln = rr$loc_name[i], lt = rr$loc_type[i],
      n = if (is.na(rr$count[i])) NULL else as.integer(rr$count[i]),
      r = rr$mun_slug[i]
    )))
  ), file.path(SP_DIR, paste0(code, ".json")))
}
msg("  wrote ", length(sp_split), " species files")

# ---- meta.json --------------------------------------------------------------

citation <- paste(readLines(EBD_CITATION_FILE, warn = FALSE), collapse = " ")
lmi_version <- attr(readRDS(file.path(WORK_DIR, "sveitarfelog.rds")), "lmi_version")

write_json_min(list(
  generated   = format(Sys.Date()),
  ebdRelease  = EBD_RELEASE,
  lmiVersion  = lmi_version,
  citation    = trimws(citation),
  dateRange   = arr(c(as.integer(min(chk$date)), as.integer(max(chk$date)))),
  regions     = as.list(region_map),
  countryChecklists = COUNTRY_CHECKLISTS,
  totals = list(
    species        = obs[countable == TRUE, data.table::uniqueN(speciesCode)],
    taxa           = obs[, data.table::uniqueN(speciesCode)],
    checklists     = nrow(chk),
    observations   = nrow(obs),
    observers      = data.table::uniqueN(chk$obsr),
    municipalities = length(slugs),
    areas          = nrow(area_meta)
  )
), file.path(DATA_DIR, "meta.json"))
msg("  wrote meta.json")

# ---- guard against auto_unbox collapsing arrays -----------------------------
# Re-read what was written for the thinnest region and the rarest species and
# check that fields the site indexes as arrays really are arrays. A length-1
# vector that slipped through unwrapped produces `undefined` in the UI rather
# than an error, so it has to be caught here -- and the thinnest cases are the
# ones that collapse.

msg("Checking array shapes in the written JSON")

must_be_arrays <- function(path, keys) {
  j <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  for (k in keys) {
    v <- j[[k]]
    if (!is.null(v) && !is.list(v)) {
      stop("auto_unbox collapsed `", k, "` in ", path, " -- wrap it in arr()")
    }
  }
  invisible(j)
}

reg_dt <- data.table::rbindlist(lapply(regions, function(r)
  data.table::data.table(id = r$id, kind = r$kind, checklists = r$checklists)))
thin <- reg_dt[checklists > 0][which.min(checklists)]$id
thin_mun <- reg_dt[kind %chin% c("sveitarfelag", "sea")][which.min(checklists)]$id
for (id in unique(c(thin, thin_mun, COUNTRY_ID))) {
  must_be_arrays(file.path(REGION_DIR, id, "summary.json"), "species")
  must_be_arrays(file.path(REGION_DIR, id, "cube.json"),
                 c("sp", "si", "y", "m", "n", "c", "ysi", "yy", "yf", "yl",
                   "ey", "em", "en", "ec"))
}
for (id in c(thin_mun, COUNTRY_ID)) {
  must_be_arrays(file.path(REGION_DIR, id, "checklists.json"),
                 c("sub", "date", "loc", "obsr", "proto", "nsp", "obsrs", "protos"))
}
must_be_arrays(file.path(REGION_DIR, thin_mun, "obs.json"), c("sp", "si", "k", "n", "media"))

rare <- all_species[, .N, by = c][which.min(N)]$c
j <- must_be_arrays(file.path(SP_DIR, paste0(rare, ".json")), c("regions", "recent"))
msg("  array shapes OK (checked ", thin, ", ", thin_mun, " and ", rare, ")")

# ---- report -----------------------------------------------------------------

sizes <- data.table::data.table(
  file = list.files(DATA_DIR, recursive = TRUE, full.names = TRUE)
)
sizes[, kb := round(file.info(file)$size / 1024)]
data.table::setorder(sizes, -kb)
msg("Largest payloads:")
for (i in seq_len(min(6, nrow(sizes)))) {
  msg("    ", formatC(sizes$kb[i], width = 7, big.mark = ","), " KB  ",
      sub(paste0(DATA_DIR, "/"), "", sizes$file[i], fixed = TRUE))
}
msg("  total ", round(sum(sizes$kb) / 1024, 1), " MB across ", nrow(sizes), " files")

invisible(regions)
