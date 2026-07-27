# 04_build_tables.R -- read the EBD, roll up taxonomy, dedupe shared checklists,
# and attach the municipality derived in step 03.
#
# Produces:
#   work/checklists_mun.rds
#   work/obs_mun.rds

source("R/00_config.R")

# ---- why this does not call auk_rollup() / auk_unique() ---------------------
#
# The plan was to lean on auk for both. Reading the EBD closely changed that:
#
# 1. auk_rollup() resolves subspecies by inner-joining SCIENTIFIC NAME against
#    `auk::ebird_taxonomy`, which ships frozen at taxonomy version 2024. This
#    EBD is the Jun-2026 release, so every taxon split or renamed since 2024
#    would be dropped with a warning. We already fetch the *current* taxonomy in
#    step 02, so we join against that instead.
#
#    The rollup itself turns out to be trivial, because the EBD already puts the
#    parent species binomial in SCIENTIFIC NAME and the sub-taxon in SUBSPECIES
#    SCIENTIFIC NAME:
#        issf     Rissa tridactyla        | Rissa tridactyla tridactyla
#        form     Acanthis flammea        | Acanthis flammea flammea/rostrata/...
#        domestic Columba livia           | Columba livia (Feral Pigeon)
#    while spuh / slash / hybrid carry names that are not binomials at all
#    ("Acanthis/Spinus sp.", "Anser fabalis/serrirostris", "Anas platyrhynchos x
#    acuta"). So "is this countable as a species?" reduces to "does SCIENTIFIC
#    NAME match a taxon whose category is `species`?" -- exactly auk's rule,
#    against a taxonomy that matches the data.
#
# 2. auk_unique() collapses a shared checklist into one row whose
#    sampling_event_identifier becomes "S1,S2,S3" and whose observer_id becomes
#    "obsrA,obsrB". That is fine for analysis and fatal here: every row in this
#    interface has to link to one real ebird.org/checklist/S... page. We keep a
#    single canonical checklist per group instead.

suppressPackageStartupMessages({
  library(data.table)
})

data.table::setDTthreads(0)

tax <- readRDS(file.path(WORK_DIR, "taxonomy.rds"))
locmun <- readRDS(file.path(WORK_DIR, "locality_municipality.rds"))

# Species-level binomials, used as the countability test.
species_sci <- tax[category == "species", unique(sci)]

# ---- 1. checklists ----------------------------------------------------------

msg("Reading the sampling file")

chk <- data.table::fread(
  EBD_SAMPLING_FILE,
  select = c("SAMPLING EVENT IDENTIFIER", "LOCALITY ID", "LOCALITY TYPE",
             "OBSERVATION DATE", "TIME OBSERVATIONS STARTED", "OBSERVER ID",
             "PROTOCOL NAME", "DURATION MINUTES", "EFFORT DISTANCE KM",
             "NUMBER OBSERVERS", "ALL SPECIES REPORTED", "GROUP IDENTIFIER",
             "STATE CODE"),
  col.names = c("sub", "loc_id", "loc_type", "date", "time", "obsr",
                "protocol", "duration", "distance", "n_observers",
                "complete", "group_id", "state_code"),
  quote = "", showProgress = FALSE, encoding = "UTF-8"
)

msg("  ", format(nrow(chk), big.mark = ","), " checklists")

# ---- 2. collapse shared checklists ------------------------------------------
# A group outing submitted by five observers is five rows with one GROUP
# IDENTIFIER. Counting all five would inflate every checklist total. Keep the
# lowest sampling event id as the canonical one, and record how many
# submissions the group had so the UI can say so.

chk[, group_id := fifelse(group_id == "", NA_character_, group_id)]
setorder(chk, sub)

grouped <- !is.na(chk$group_id)
msg("  ", sum(grouped), " checklists belong to ",
    data.table::uniqueN(chk$group_id[grouped]), " shared groups")

chk[, n_submissions := 1L]
chk[grouped, n_submissions := .N, by = group_id]
chk[, canonical := TRUE]
chk[grouped, canonical := sub == sub[1], by = group_id]

chk_all <- copy(chk)                 # keep the un-deduped copy for observer views
chk <- chk[canonical == TRUE]
msg("  ", format(nrow(chk), big.mark = ","), " checklists after collapsing groups")

# ---- 3. attach municipality -------------------------------------------------

chk <- merge(chk, locmun[, .(loc_id, loc_name, mun_slug, mun_name, region,
                             placement, offshore, area_id)],
             by = "loc_id", all.x = TRUE)
stopifnot(!anyNA(chk$mun_slug))

chk[, `:=`(
  year  = as.integer(substr(date, 1, 4)),
  month = as.integer(substr(date, 6, 7))
)]
chk[, complete := as.integer(complete)]

# ---- 4. observations --------------------------------------------------------

msg("Reading the observation file (707 MB, 16 of 52 columns)")

obs <- data.table::fread(
  EBD_OBS_FILE,
  select = c("CATEGORY", "COMMON NAME", "SCIENTIFIC NAME", "EXOTIC CODE",
             "OBSERVATION COUNT", "LOCALITY ID", "OBSERVATION DATE",
             "OBSERVER ID", "SAMPLING EVENT IDENTIFIER", "GROUP IDENTIFIER",
             "HAS MEDIA", "BREEDING CATEGORY"),
  col.names = c("category", "com_name", "sci", "exotic", "count_raw",
                "loc_id", "date", "obsr", "sub", "group_id", "has_media",
                "breeding"),
  quote = "", showProgress = FALSE, encoding = "UTF-8"
)

msg("  ", format(nrow(obs), big.mark = ","), " observations")

# "X" means present but not counted. It must stay distinguishable from 0 and
# must never be treated as a number when finding high counts.
obs[, count := suppressWarnings(as.integer(count_raw))]
obs[, count_raw := NULL]

# eBird does not count escapees towards a region's species total.
n_escapee <- obs[exotic == EXCLUDE_EXOTIC, .N]
obs[, countable := sci %chin% species_sci & exotic != EXCLUDE_EXOTIC]
msg("  ", format(obs[, sum(countable)], big.mark = ","), " countable, ",
    format(obs[, sum(!countable)], big.mark = ","), " not (",
    n_escapee, " escapees, rest spuh/slash/hybrid)")

# Flag anything the taxonomy does not recognise at all, rather than dropping it
# silently.
unknown <- obs[!sci %chin% tax$sci, unique(sci)]
if (length(unknown)) {
  msg("  WARNING: ", length(unknown), " scientific names absent from the ",
      "taxonomy: ", paste(utils::head(unknown, 5), collapse = ", "))
}

# ---- 5. roll up subspecies --------------------------------------------------
# Within one checklist, several rows can share a species (nominate ssp + an
# unidentified bird of the same species). Sum their counts; the result is "X"
# only when every contributing row was "X".

before <- nrow(obs)
obs[, has_media := as.integer(has_media)]

obs <- obs[, .(
  count      = if (all(is.na(count))) NA_integer_ else sum(count, na.rm = TRUE),
  category   = category[1],
  com_name   = com_name[1],
  exotic     = exotic[which.max(exotic != "")][1],
  has_media  = max(has_media),
  breeding   = breeding[which.max(breeding != "")][1],
  countable  = countable[1],
  loc_id     = loc_id[1],
  date       = date[1],
  obsr       = obsr[1],
  group_id   = group_id[1]
), by = .(sub, sci)]

msg("  rolled up ", format(before, big.mark = ","), " -> ",
    format(nrow(obs), big.mark = ","), " checklist x species rows")

# ---- 6. drop the non-canonical copies of shared checklists ------------------

canonical_subs <- chk$sub
obs <- obs[sub %chin% canonical_subs]
msg("  ", format(nrow(obs), big.mark = ","), " after collapsing shared checklists")

# ---- 7. attach municipality and species code -------------------------------

obs <- merge(obs, locmun[, .(loc_id, loc_name, loc_type, mun_slug, mun_name,
                             region, offshore, area_id)],
             by = "loc_id", all.x = TRUE)
stopifnot(!anyNA(obs$mun_slug))

obs <- merge(obs, tax[, .(sci, speciesCode, en, is, taxonOrder, family)],
             by = "sci", all.x = TRUE)

obs[, `:=`(
  year  = as.integer(substr(date, 1, 4)),
  month = as.integer(substr(date, 6, 7))
)]

# ---- 8. write ---------------------------------------------------------------

saveRDS(chk,     file.path(WORK_DIR, "checklists_mun.rds"))
saveRDS(obs,     file.path(WORK_DIR, "obs_mun.rds"))
saveRDS(chk_all, file.path(WORK_DIR, "checklists_all.rds"))

msg("  wrote work/checklists_mun.rds and work/obs_mun.rds")

# ---- 9. sanity ---------------------------------------------------------------

msg("Species per eBird region (countable, all years):")
reg <- obs[countable == TRUE, .(species = uniqueN(speciesCode)), by = region]
setorder(reg, region)
for (i in seq_len(nrow(reg))) {
  msg("    ", formatC(reg$region[i], width = -6), " ", reg$species[i])
}
msg("    Iceland total: ", obs[countable == TRUE, uniqueN(speciesCode)])

invisible(list(chk = chk, obs = obs))
