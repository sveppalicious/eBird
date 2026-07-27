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

# The exported payloads must add up to the tables they came from.
meta <- jsonlite::fromJSON(file.path(DATA_DIR, "meta.json"))
stopifnot(
  sum(meta$municipalities$checklists)   == nrow(chk),
  sum(meta$municipalities$observations) == nrow(obs)
)
msg("meta.json:          municipality totals match the tables  OK")

# The fourth level must tile each municipality exactly: areas are built as the
# intersection of the two layers, so anything else means a locality slipped
# between them.
areas <- readRDS(file.path(WORK_DIR, "areas.rds"))
placed <- chk[!is.na(area_id)]
stopifnot(nrow(placed) + chk[mun_slug == OPEN_SEA_SLUG, .N] == nrow(chk))
per_mun <- placed[, .(a = .N), by = mun_slug]
tot_mun <- chk[mun_slug != OPEN_SEA_SLUG, .N, by = mun_slug]
stopifnot(all.equal(per_mun[order(mun_slug)]$a, tot_mun[order(mun_slug)]$N))
kind <- stats::setNames(areas$kind, areas$area_id)
used <- unique(placed$area_id)
msg("Sub-areas:          ", length(used), " with checklists, of ", nrow(areas),
    " built; every checklist outside Hafsvaedi has one  OK")
msg("                    ", sum(kind[used] == "hverfi"), " named neighbourhoods, ",
    sum(kind[used] == "postnumer"), " postal areas")

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
msg("  Reference: eBird showed Hofudborgarsvaedi (IS-1) at 224 species on ",
    "25 Jul 2026.")
msg("  Ours should be at or a little below that -- this EBD is the ",
    EBD_RELEASE, " snapshot, which ends 30 Jun 2026.")

msg("")
msg("Done in ", round(as.numeric(difftime(Sys.time(), t0, units = "mins")), 1),
    " minutes. Serve the site with:  ./serve.sh")
