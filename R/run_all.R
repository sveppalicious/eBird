# run_all.R -- rebuild everything from the raw EBD.
#
#   Rscript R/run_all.R
#
# Run from the project root. Takes about two minutes, most of it reading the
# 707 MB observation file. Steps 01 and 02 hit the network (LMI's WFS and the
# eBird taxonomy API) and cache their downloads under work/, so re-runs are
# offline unless you delete those.

source("R/00_config.R")

t0 <- Sys.time()

steps <- c("R/01_boundaries.R", "R/01b_areas.R", "R/02_taxonomy.R",
           "R/03_assign_localities.R", "R/04_build_tables.R", "R/05_export_json.R")

for (s in steps) {
  msg(strrep("-", 62))
  msg("== ", s)
  source(s, local = new.env())
}

# ---- conservation checks ----------------------------------------------------
# Every raw row has to end up somewhere. These assertions are the difference
# between "the pipeline ran" and "the pipeline is right", so they run every time.

msg(strrep("-", 62))
msg("== verification")

count_lines <- function(path) {
  as.integer(sub("^\\s*(\\d+).*", "\\1",
                 system2("wc", c("-l", shQuote(path)), stdout = TRUE))) - 1L
}

raw_obs <- count_lines(EBD_OBS_FILE)
raw_chk <- count_lines(EBD_SAMPLING_FILE)

locmun  <- readRDS(file.path(WORK_DIR, "locality_municipality.rds"))
chk     <- readRDS(file.path(WORK_DIR, "checklists_mun.rds"))
chk_all <- readRDS(file.path(WORK_DIR, "checklists_all.rds"))
obs     <- readRDS(file.path(WORK_DIR, "obs_mun.rds"))

msg("Raw EBD:            ", format(raw_obs, big.mark = ","), " observations, ",
    format(raw_chk, big.mark = ","), " checklists")

# Every checklist in the sampling file is accounted for: kept, or collapsed into
# the canonical submission of a shared group.
stopifnot(nrow(chk_all) == raw_chk)
stopifnot(nrow(chk) + sum(!chk_all$canonical) == raw_chk)
msg("Checklists:         ", format(nrow(chk), big.mark = ","), " kept + ",
    format(sum(!chk_all$canonical), big.mark = ","),
    " shared duplicates = ", format(raw_chk, big.mark = ","), "  OK")

# Every locality got a municipality (Hafsvaedi counts as one).
stopifnot(!anyNA(locmun$mun_slug))
msg("Localities:         ", format(nrow(locmun), big.mark = ","),
    " all placed  OK")

# No observation lost its municipality.
stopifnot(!anyNA(obs$mun_slug))
msg("Observations:       ", format(nrow(obs), big.mark = ","),
    " rows after rollup and group collapse, none unplaced  OK")

# The exported payloads must add up to the tables they came from, at every
# level: the country is the whole table, the sveitarfelog partition it, and the
# areas partition each sveitarfelag.
meta <- jsonlite::fromJSON(file.path(DATA_DIR, "meta.json"))
reg  <- data.table::as.data.table(
  jsonlite::fromJSON(file.path(DATA_DIR, "regions.json"))$regions)
country <- reg[kind == "country"]
muns    <- reg[kind %chin% c("sveitarfelag", "sea")]
subs    <- reg[kind %chin% c("hverfi", "postnumer")]
stopifnot(
  nrow(country) == 1L,
  country$checklists == nrow(chk), country$observations == nrow(obs),
  sum(muns$checklists) == nrow(chk), sum(muns$observations) == nrow(obs)
)
msg("regions.json:       country and sveitarfelag totals match the tables  OK")

# The fourth level must tile each municipality exactly: areas are built as the
# intersection of the two layers, so anything else means a locality slipped
# between them.
areas <- readRDS(file.path(WORK_DIR, "areas.rds"))
placed <- chk[!is.na(area_id)]
stopifnot(nrow(placed) + chk[mun_slug == OPEN_SEA_SLUG, .N] == nrow(chk))
tiled <- merge(subs[, .(a = sum(checklists)), by = .(id = parent)],
               muns[, .(id, m = checklists)], by = "id")
stopifnot(all(tiled$a == tiled$m))
kind <- stats::setNames(areas$kind, areas$area_id)
used <- unique(placed$area_id)
msg("Sub-areas:          ", length(used), " with checklists, of ", nrow(areas),
    " built; every checklist outside Hafsvaedi has one  OK")
msg("                    ", sum(kind[used] == "hverfi"), " named neighbourhoods, ",
    sum(kind[used] == "postnumer"), " postal areas")

# Every area drawn on the map has to exist as a region, whether or not anyone
# has birded it: the map makes them clickable, so an area with no files is a
# link to a page that cannot render.
stopifnot(setequal(subs$id, areas$area_id),
          all(file.exists(file.path(REGION_DIR, reg$id, "summary.json"))),
          all(file.exists(file.path(REGION_DIR, reg$id, "cube.json"))))
msg("                    every built area is a region with its files  OK")

# A postal district can straddle a municipality boundary, so the same label can
# legitimately appear more than once. Report it rather than letting it look like
# duplicated polygons on the map.
dup <- table(areas$label)
dup <- dup[dup > 1]
if (length(dup)) {
  msg("                    ", length(dup), " postal districts cross a municipality ",
      "boundary and are split (", sum(dup), " areas)")
}

# The cube is the same data cut by year and month, so it has to fold back up to
# the summary beside it: per species, cells sum to its checklist count; and the
# effort cells sum to the region's checklists. Checked at all three levels.
check_cube <- function(id) {
  cube <- jsonlite::fromJSON(file.path(REGION_DIR, id, "cube.json"))
  sm   <- jsonlite::fromJSON(file.path(REGION_DIR, id, "summary.json"))
  st   <- sm$stats
  if (length(cube$si)) {
    per <- tapply(cube$n, cube$si, sum)
    perc <- tapply(cube$c, cube$si, sum)
    stopifnot(all(cube$sp == sm$species$c),
              all(unname(per)  == sm$species$k),
              all(unname(perc) == sm$species$kc),
              all(cube$c <= cube$n))
  }
  # An empty region writes `[]`, which reads back as a list rather than a
  # numeric vector -- 806 in Grimsnes- og Grafningshreppur is one.
  num <- function(v) as.numeric(unlist(v))
  stopifnot(sum(num(cube$en)) == st$checklists, sum(num(cube$ec)) == st$complete)
  invisible(length(cube$si))
}
cells <- vapply(reg$id, check_cube, numeric(1))
msg("Cubes:              ", format(sum(cells), big.mark = ","),
    " cells fold back to the summaries in all ", nrow(reg), " regions  OK")

# Species counts per eBird region, for comparison against ebird.org. Ours should
# be at or just below the live site: this EBD is the ", EBD_RELEASE, " snapshot.
msg("")
msg("Species per eBird region (compare with ebird.org/region/IS-x):")
reg <- merge(obs[countable == TRUE], chk[, .(sub, state_code)], by = "sub")
regnames <- unlist(meta$regions)
# A handful of rows carry a bare "IS-" with no region digit. Report them
# separately rather than letting them break the table.
per <- reg[, .(species = data.table::uniqueN(speciesCode)), by = state_code]
data.table::setorder(per, state_code)
for (i in seq_len(nrow(per))) {
  code <- per$state_code[i]
  nm <- if (code %in% names(regnames)) regnames[[code]] else "(no region code)"
  msg("    ", formatC(code, width = -6), formatC(nm, width = -22), " ",
      per$species[i])
}
msg("    Iceland total: ", obs[countable == TRUE, data.table::uniqueN(speciesCode)])
msg("")
msg("  Ours should be at or a little below ebird.org -- this EBD is the ",
    EBD_RELEASE, " snapshot, which ends ", format(max(chk$date), "%d %b %Y"), ".")

msg("")
msg("Done in ", round(as.numeric(difftime(Sys.time(), t0, units = "mins")), 1),
    " minutes. Serve the site with:  ./serve.sh")
