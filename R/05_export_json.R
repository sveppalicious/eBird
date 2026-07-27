# 05_export_json.R -- write the static payloads the site reads.
#
# Layout under site/data/:
#   meta.json                  municipality index + totals, drives the map
#   taxonomy.json              only the taxa that occur in Iceland
#   geo/sveitarfelog.json      written by 01_boundaries.R
#   mun/<slug>/summary.json    the Bird List (default all-years view)
#   mun/<slug>/checklists.json checklist browser, and the dictionary obs.json indexes into
#   mun/<slug>/obs.json        every observation, lazy-loaded for filtered views
#
# Everything bulky is columnar with integer dictionaries: localities, observers
# and protocols repeat heavily, and gzip plus dictionaries turns a 15 MB naive
# dump into something a browser is happy to fetch on demand.

source("R/00_config.R")

suppressPackageStartupMessages({
  library(data.table)
  library(jsonlite)
})

EPOCH <- as.Date("1970-01-01")

obs <- readRDS(file.path(WORK_DIR, "obs_mun.rds"))
chk <- readRDS(file.path(WORK_DIR, "checklists_mun.rds"))
tax <- readRDS(file.path(WORK_DIR, "taxonomy.rds"))
mun <- sf::st_drop_geometry(readRDS(file.path(WORK_DIR, "sveitarfelog.rds")))
locmun <- readRDS(file.path(WORK_DIR, "locality_municipality.rds"))
area_meta <- data.table::as.data.table(
  sf::st_drop_geometry(readRDS(file.path(WORK_DIR, "areas.rds"))))

write_json_min <- function(x, path) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, na = "null",
                       digits = 6, null = "null")
}

# auto_unbox is what keeps scalars like `"slug": "0000-..."` from being written
# as one-element arrays -- but it applies to *every* length-1 vector, so a
# municipality where a species was seen in a single year would emit
# `"y": 2019` instead of `"y": [2019]`, and every consumer indexing it as an
# array silently gets undefined. Wrap anything that must stay an array in arr().
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
unlink(file.path(DATA_DIR, "taxonomy_full.json"))

# ---- per-municipality checklist species counts ------------------------------

nsp <- obs[, .(nsp = .N), by = sub]
chk <- merge(chk, nsp, by = "sub", all.x = TRUE)
chk[is.na(nsp), nsp := 0L]

data.table::setorder(chk, mun_slug, -date, sub)
data.table::setorder(obs, mun_slug, taxonOrder, date)

# Headline figures per postal area, so the municipality page can list them
# without loading the observations.
area_summary <- function(co, oo, area_ids) {
  if (!length(area_ids)) return(list())
  info <- area_meta[area_id %chin% area_ids]
  data.table::setkey(info, area_id)
  lapply(area_ids, function(a) {
    ca <- co[area_id == a]
    oa <- oo[area_id == a]
    i <- info[a]
    list(
      id         = a,
      code       = i$code,        # the URL segment
      label      = i$label,       # what the page shows
      kind       = i$kind,        # "hverfi" or "postnumer"
      postnumer  = i$postnumer,   # NA for named neighbourhoods
      areaKm2    = i$area_km2,
      species    = data.table::uniqueN(oa[countable == TRUE]$speciesCode),
      taxa       = data.table::uniqueN(oa$speciesCode),
      checklists = nrow(ca),
      complete   = sum(ca$complete, na.rm = TRUE),
      observations = nrow(oa),
      observers  = data.table::uniqueN(ca$obsr),
      localities = data.table::uniqueN(ca$loc_id)
    )
  })
}

# ---- writer for one municipality --------------------------------------------

export_municipality <- function(slug) {
  co <- chk[mun_slug == slug]
  oo <- obs[mun_slug == slug]
  if (!nrow(co)) return(NULL)

  dir <- file.path(MUN_DIR, slug)
  if (!dir.exists(dir)) dir.create(dir, recursive = TRUE)

  # --- dictionaries, shared by checklists.json and obs.json -----------------
  locs <- unique(co[, .(loc_id, loc_name, loc_type)])
  data.table::setorder(locs, loc_id)
  locs[, idx := .I - 1L]

  # Postal areas of this municipality that actually hold checklists. Areas are
  # carried as a column on the checklists rather than as their own payloads:
  # obs.json already indexes into the checklists, so the whole fourth level
  # comes for free client-side instead of tripling the file count.
  area_ids <- sort(unique(stats::na.omit(co$area_id)))

  obsrs  <- sort(unique(co$obsr));     obsr_idx  <- stats::setNames(seq_along(obsrs) - 1L, obsrs)
  protos <- sort(unique(co$protocol)); proto_idx <- stats::setNames(seq_along(protos) - 1L, protos)

  co[, `:=`(
    li = locs$idx[match(loc_id, locs$loc_id)],
    oi = unname(obsr_idx[obsr]),
    pi = unname(proto_idx[protocol])
  )]
  co[, ki := .I - 1L]          # this municipality's checklist index

  # --- checklists.json ------------------------------------------------------
  write_json_min(list(
    slug   = slug,
    locs   = list(id = arr(locs$loc_id), name = arr(locs$loc_name),
                  type = arr(locs$loc_type)),
    obsrs  = arr(obsrs),
    protos = arr(protos),
    sub    = arr(co$sub),
    date   = arr(as.integer(co$date)),
    time   = arr(co$time),
    loc    = arr(co$li),
    obsr   = arr(co$oi),
    proto  = arr(co$pi),
    dur    = arr(co$duration),
    dist   = arr(co$distance),
    nobsr  = arr(co$n_observers),
    comp   = arr(co$complete),
    nsp    = arr(co$nsp),
    shared = arr(as.integer(co$n_submissions > 1L)),
    areas  = arr(area_ids),
    area   = arr(match(co$area_id, area_ids) - 1L)
  ), file.path(dir, "checklists.json"))

  # --- obs.json -------------------------------------------------------------
  # Sorted by species then date, so gzip sees long runs of near-identical
  # integers. `n` is null where the observer reported "X" (present, uncounted).
  oo[, ki := co$ki[match(sub, co$sub)]]
  sp_codes <- oo[, unique(speciesCode)]
  sp_idx <- stats::setNames(seq_along(sp_codes) - 1L, sp_codes)
  oo[, si := unname(sp_idx[speciesCode])]

  write_json_min(list(
    slug = slug,
    sp   = arr(sp_codes),
    si   = arr(oo$si),
    k    = arr(oo$ki),
    n    = arr(oo$count),
    # media is rare, so ship the indices that have it rather than a full column
    media = arr(which(oo$has_media == 1L) - 1L)
  ), file.path(dir, "obs.json"))

  # --- summary.json: the Bird List -----------------------------------------
  # For each species: totals plus the three records eBird surfaces. Each record
  # carries everything the four hyperlinks in the table need.
  pick <- function(d, i) list(
    d = as.integer(d$date[i]), s = d$sub[i], b = d$obsr[i],
    l = locs$idx[match(d$loc_id[i], locs$loc_id)],
    n = if (is.na(d$count[i])) NULL else as.integer(d$count[i])
  )

  sp_rows <- lapply(split(seq_len(nrow(oo)), oo$speciesCode), function(ix) {
    d <- oo[ix]
    i_first <- which.min(d$date)
    i_last  <- which.max(d$date)
    i_high  <- if (all(is.na(d$count))) i_last else which.max(d$count)
    list(
      c     = d$speciesCode[1],
      o     = nrow(d),
      k     = data.table::uniqueN(d$sub),
      # Countability is per record, not per species: escapee (EXOTIC CODE = X)
      # sightings sit alongside wild ones for Mute Swan, Eurasian Kestrel,
      # Graylag Goose and four others. One countable record makes the species
      # countable here, which is how the headline species total is computed too.
      x     = as.integer(any(d$countable)),
      ord   = d$taxonOrder[1],
      y     = arr(sort(unique(as.integer(d$year)))),
      first = pick(d, i_first),
      last  = pick(d, i_last),
      high  = pick(d, i_high)
    )
  })
  sp_rows <- sp_rows[order(vapply(sp_rows, function(r) r$ord, numeric(1)))]
  names(sp_rows) <- NULL

  minfo <- mun[mun$slug == slug, ]
  countable <- oo[countable == TRUE]

  write_json_min(list(
    slug       = slug,
    name       = if (nrow(minfo)) minfo$name else OPEN_SEA_NAME,
    nr         = if (nrow(minfo)) minfo$nr else NA_integer_,
    areaKm2    = if (nrow(minfo)) minfo$area_km2 else NA_real_,
    region     = co$region[1],
    regionName = unname(region_map[co$region[1]]),
    # Almost every coastal municipality has *some* offshore locality, so a bare
    # any() would tag nearly all of them and mean nothing. Report the count and
    # let the UI decide what is worth flagging.
    offshoreChecklists = sum(co$offshore),
    stats = list(
      species     = data.table::uniqueN(countable$speciesCode),
      taxa        = data.table::uniqueN(oo$speciesCode),
      checklists  = nrow(co),
      complete    = sum(co$complete, na.rm = TRUE),
      observations= nrow(oo),
      observers   = length(obsrs),
      media       = data.table::uniqueN(oo[has_media == 1L]$speciesCode),
      offshoreChecklists = sum(co$offshore),
      firstDate   = as.integer(min(co$date)),
      lastDate    = as.integer(max(co$date))
    ),
    locs    = list(id = arr(locs$loc_id), name = arr(locs$loc_name),
                   type = arr(locs$loc_type)),
    areas   = arr(area_summary(co, oo, area_ids)),
    species = arr(sp_rows)
  ), file.path(dir, "summary.json"))

  data.table::data.table(
    slug = slug,
    species = data.table::uniqueN(countable$speciesCode),
    taxa = data.table::uniqueN(oo$speciesCode),
    checklists = nrow(co),
    complete = sum(co$complete, na.rm = TRUE),
    observations = nrow(oo),
    observers = length(obsrs),
    media = data.table::uniqueN(oo[has_media == 1L]$speciesCode),
    region = co$region[1],
    offshoreChecklists = sum(co$offshore),
    areas = length(area_ids)
  )
}

# ---- run --------------------------------------------------------------------

slugs <- sort(unique(chk$mun_slug))
msg("Exporting ", length(slugs), " municipalities")

stats <- data.table::rbindlist(lapply(seq_along(slugs), function(i) {
  s <- slugs[i]
  if (i %% 10 == 0) msg("  ", i, "/", length(slugs))
  export_municipality(s)
}))

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
# the category up in taxonomy.json, which only holds the 502 taxa recorded in
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
# so the file stays small.
# `type` travels too: the personal export says nothing about whether a locality
# is a hotspot, and without that the site cannot decide which of a user's own
# localities get an ebird.org/hotspot link.
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

# ---- per-species: where in Iceland has it been recorded? --------------------
# The mirror image of summary.json. One small file per taxon, each holding the
# municipality breakdown, so the species view is a single fetch rather than
# reading all 62 municipality summaries.

SP_DIR <- file.path(DATA_DIR, "sp")
if (!dir.exists(SP_DIR)) dir.create(SP_DIR, recursive = TRUE)

msg("Exporting ", data.table::uniqueN(obs$speciesCode), " species")

mun_names <- unique(obs[, .(mun_slug, mun_name, region)])

data.table::setorder(obs, speciesCode, mun_slug, date)

pick_sp <- function(d, i) list(
  d = as.integer(d$date[i]), s = d$sub[i], b = d$obsr[i],
  l = d$loc_id[i], ln = d$loc_name[i], lt = d$loc_type[i],
  n = if (is.na(d$count[i])) NULL else as.integer(d$count[i])
)

species_index <- data.table::rbindlist(lapply(
  split(seq_len(nrow(obs)), obs$speciesCode), function(ix) {
    d <- obs[ix]
    code <- d$speciesCode[1]

    per_mun <- lapply(split(seq_len(nrow(d)), d$mun_slug), function(jx) {
      m <- d[jx]
      i_first <- which.min(m$date)
      i_last  <- which.max(m$date)
      i_high  <- if (all(is.na(m$count))) i_last else which.max(m$count)
      list(
        slug   = m$mun_slug[1],
        name   = m$mun_name[1],
        region = m$region[1],
        regionName = unname(region_map[m$region[1]]),
        k      = data.table::uniqueN(m$sub),
        y      = arr(sort(unique(as.integer(m$year)))),
        first  = pick_sp(m, i_first),
        last   = pick_sp(m, i_last),
        high   = pick_sp(m, i_high)
      )
    })
    per_mun <- per_mun[order(-vapply(per_mun, function(r) r$k, numeric(1)))]
    names(per_mun) <- NULL

    counts <- d$count[!is.na(d$count)]
    write_json_min(list(
      c            = code,
      countable    = as.integer(any(d$countable)),
      checklists   = data.table::uniqueN(d$sub),
      observations = nrow(d),
      municipalities = length(per_mun),
      highCount    = if (length(counts)) max(counts) else NULL,
      firstDate    = as.integer(min(d$date)),
      lastDate     = as.integer(max(d$date)),
      years        = arr(sort(unique(as.integer(d$year)))),
      mun          = arr(per_mun)
    ), file.path(SP_DIR, paste0(code, ".json")))

    data.table::data.table(
      c = code,
      countable = as.integer(any(d$countable)),
      k = data.table::uniqueN(d$sub),
      m = length(per_mun),
      firstDate = as.integer(min(d$date)),
      lastDate = as.integer(max(d$date))
    )
  }))

# The index drives the browsable species list; join on the taxonomy for names.
species_index <- merge(
  species_index,
  tax_used[, .(c = speciesCode, ord = taxonOrder)],
  by = "c", all.x = TRUE
)
data.table::setorder(species_index, ord)
write_json_min(species_index, file.path(DATA_DIR, "species_index.json"))
msg("  wrote species_index.json and ", nrow(species_index), " species files")

# ---- meta.json --------------------------------------------------------------

sp_year <- obs[countable == TRUE,
               .(n = data.table::uniqueN(speciesCode)), by = .(mun_slug, year)]

meta_mun <- merge(
  stats,
  data.table::as.data.table(mun)[, .(slug, name, nr, areaKm2 = area_km2)],
  by = "slug", all.x = TRUE
)
meta_mun[slug == OPEN_SEA_SLUG, `:=`(name = OPEN_SEA_NAME, nr = NA_integer_)]
meta_mun[, regionName := unname(region_map[region])]
data.table::setorder(meta_mun, -species)

meta_mun_list <- lapply(seq_len(nrow(meta_mun)), function(i) {
  r <- meta_mun[i]
  yr <- sp_year[mun_slug == r$slug]
  data.table::setorder(yr, year)
  c(as.list(r), list(spByYear = stats::setNames(as.list(yr$n), as.character(yr$year))))
})

# Every area nationally, not just the one municipality being viewed. Without
# this an area map paints its neighbours grey -- reading as "no records" when
# they are simply in the next sveitarfelag.
area_species <- obs[!is.na(area_id) & countable == TRUE,
                    .(species = data.table::uniqueN(speciesCode)), by = area_id]
area_chk <- chk[!is.na(area_id), .(checklists = .N), by = area_id]
areas_index <- merge(
  area_meta[, .(id = area_id, slug, code, label, kind)],
  merge(area_species, area_chk, by = "area_id", all = TRUE),
  by.x = "id", by.y = "area_id", all.x = TRUE
)
areas_index[is.na(species), species := 0L]
areas_index[is.na(checklists), checklists := 0L]
data.table::setorder(areas_index, slug, code)

citation <- paste(readLines(EBD_CITATION_FILE, warn = FALSE), collapse = " ")
lmi_version <- attr(readRDS(file.path(WORK_DIR, "sveitarfelog.rds")), "lmi_version")

write_json_min(list(
  generated   = format(Sys.Date()),
  ebdRelease  = EBD_RELEASE,
  lmiVersion  = lmi_version,
  citation    = trimws(citation),
  dateRange   = arr(c(as.integer(min(chk$date)), as.integer(max(chk$date)))),
  years       = arr(sort(unique(as.integer(obs$year)))),
  regions     = as.list(region_map),
  totals = list(
    species        = obs[countable == TRUE, data.table::uniqueN(speciesCode)],
    taxa           = obs[, data.table::uniqueN(speciesCode)],
    checklists     = nrow(chk),
    observations   = nrow(obs),
    observers      = data.table::uniqueN(chk$obsr),
    municipalities = nrow(meta_mun),
    areas          = data.table::uniqueN(stats::na.omit(chk$area_id))
  ),
  municipalities = arr(meta_mun_list),
  areas          = arr(lapply(seq_len(nrow(areas_index)),
                              function(i) as.list(areas_index[i])))
), file.path(DATA_DIR, "meta.json"))

msg("  wrote meta.json")

# ---- guard against auto_unbox collapsing arrays -----------------------------
# Re-read a sample of what was written and check that fields the site indexes as
# arrays really are arrays. A length-1 vector that slipped through unwrapped
# produces `undefined` in the UI rather than an error, so it has to be caught
# here. Deliberately sample taxa and municipalities with the least data, since
# those are the ones that collapse.

msg("Checking array shapes in the written JSON")

check_array <- function(path, getter, what) {
  j <- jsonlite::fromJSON(path, simplifyVector = FALSE)
  v <- getter(j)
  if (!is.null(v) && !is.list(v)) {
    stop("auto_unbox collapsed ", what, " in ", basename(path),
         " -- wrap it in arr()")
  }
  invisible(TRUE)
}

one_year <- species_index[, .SD[1], .SDcols = "c"][1]$c
thin <- obs[, .(y = data.table::uniqueN(year)), by = speciesCode][y == 1]
if (nrow(thin)) one_year <- thin$speciesCode[1]

check_array(file.path(SP_DIR, paste0(one_year, ".json")),
            function(j) j$years, "species years")
check_array(file.path(SP_DIR, paste0(one_year, ".json")),
            function(j) j$mun, "species municipalities")
check_array(file.path(SP_DIR, paste0(one_year, ".json")),
            function(j) j$mun[[1]]$y, "per-municipality years")

smallest <- meta_mun[which.min(observations)]$slug
for (f in c("summary.json", "checklists.json", "obs.json")) {
  p <- file.path(MUN_DIR, smallest, f)
  if (f == "summary.json") {
    check_array(p, function(j) j$species, "summary species")
    check_array(p, function(j) j$species[[1]]$y, "summary species years")
    check_array(p, function(j) j$locs$id, "summary locality ids")
  } else if (f == "obs.json") {
    for (k in c("sp", "si", "k", "n", "media")) {
      check_array(p, function(j) j[[k]], paste("obs", k))
    }
  } else {
    for (k in c("sub", "date", "obsr", "nsp", "obsrs")) {
      check_array(p, function(j) j[[k]], paste("checklists", k))
    }
  }
}
msg("  array shapes OK (checked ", one_year, " and ", smallest, ")")

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

invisible(meta_mun)
