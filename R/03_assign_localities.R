# 03_assign_localities.R -- the spatial core.
#
# eBird leaves COUNTY empty for every Iceland row, so the municipality has to be
# derived from coordinates. Coordinates hang off LOCALITY ID, not off individual
# observations, so this only ever touches ~41k points rather than 2M rows.
#
# Produces:
#   work/locality_municipality.rds / .csv

source("R/00_config.R")

suppressPackageStartupMessages({
  library(sf)
})

sf::sf_use_s2(FALSE)

# ---- 1. distinct localities -------------------------------------------------

msg("Reading localities from the sampling file")

loc <- data.table::fread(
  EBD_SAMPLING_FILE,
  select = c("LOCALITY ID", "LOCALITY", "LOCALITY TYPE",
             "LATITUDE", "LONGITUDE", "STATE CODE"),
  col.names = c("loc_id", "loc_name", "loc_type", "lat", "lon", "state_code"),
  quote = "", showProgress = FALSE, encoding = "UTF-8"
)

msg("  ", format(nrow(loc), big.mark = ","), " checklists")

# A locality id should have one coordinate. eBird occasionally nudges a location
# between checklists, so take the modal coordinate and report any drift.
loc[, `:=`(lat = round(lat, 7), lon = round(lon, 7))]
pos <- loc[, .N, by = .(loc_id, lat, lon)]
data.table::setorder(pos, loc_id, -N)
drift <- pos[, .N, by = loc_id][N > 1]
if (nrow(drift)) {
  msg("  NOTE: ", nrow(drift), " locality ids have more than one coordinate; ",
      "using the modal one")
}
pos <- pos[, .SD[1], by = loc_id][, .(loc_id, lat, lon)]

meta <- loc[, .SD[1], by = loc_id, .SDcols = c("loc_name", "loc_type")]
# Modal eBird region per locality -- used as the cross-check below.
region <- loc[, .N, by = .(loc_id, state_code)]
data.table::setorder(region, loc_id, -N)
region <- region[, .SD[1], by = loc_id][, .(loc_id, ebird_region = state_code)]

pts <- Reduce(function(a, b) merge(a, b, by = "loc_id"), list(pos, meta, region))
msg("  ", format(nrow(pts), big.mark = ","), " distinct localities")

# ---- 2. point in polygon ----------------------------------------------------

mun <- readRDS(file.path(WORK_DIR, "sveitarfelog.rds"))

sfpts <- sf::st_as_sf(pts, coords = c("lon", "lat"), crs = CRS_WGS84, remove = FALSE)
sfpts <- sf::st_transform(sfpts, CRS_ISN93)

msg("Point-in-polygon against ", nrow(mun), " municipalities")
idx <- sf::st_intersects(sfpts, mun)
hit <- lengths(idx) > 0
pts[, mun_idx := NA_integer_]
pts[hit, mun_idx := vapply(idx[hit], `[`, integer(1), 1)]
pts[, dist_m := 0]
pts[, placement := "inside"]

msg("  ", sum(hit), " inside a polygon; ", sum(!hit), " outside")

# ---- 3. tiered fallback for points outside every polygon --------------------
# LMI's polygons are land only (total 102,714 km2 = Iceland's land area), so
# harbours, bird islands, boat trips and pelagic checklists all land outside.

if (any(!hit)) {
  out <- which(!hit)
  near <- sf::st_nearest_feature(sfpts[out, ], mun)
  d <- as.numeric(sf::st_distance(sfpts[out, ], mun[near, ], by_element = TRUE))

  pts[out, `:=`(mun_idx = near, dist_m = round(d))]
  pts[out, placement := data.table::fcase(
    d <= NEAR_SHORE_M, "coastal",
    d <= OFFSHORE_M,   "offshore",
    default = "open_sea"
  )]
  pts[placement == "open_sea", mun_idx := NA_integer_]
}

# ---- 4. attach names --------------------------------------------------------

mun_df <- sf::st_drop_geometry(mun)
pts[, `:=`(
  mun_slug = ifelse(is.na(mun_idx), OPEN_SEA_SLUG, mun_df$slug[mun_idx]),
  mun_name = ifelse(is.na(mun_idx), OPEN_SEA_NAME, mun_df$name[mun_idx]),
  mun_nr   = ifelse(is.na(mun_idx), NA_integer_,   mun_df$nr[mun_idx])
)]
pts[, offshore := placement %in% c("offshore", "open_sea")]

msg("Placement of ", format(nrow(pts), big.mark = ","), " localities:")
tier <- pts[, .(localities = .N), by = placement]
data.table::setorder(tier, -localities)
for (i in seq_len(nrow(tier))) {
  msg("    ", formatC(tier$placement[i], width = -9), " ",
      formatC(tier$localities[i], width = 7, big.mark = ","))
}

if (pts[placement == "open_sea", .N] > nrow(pts) * 0.02) {
  warning("More than 2% of localities landed in open sea -- check the WFS layer.")
}

# ---- 5. validation gate: derived municipality vs eBird's own region ---------
# Each sveitarfelag sits inside exactly one eBird region. eBird already tells us
# the region for every checklist, so disagreement is a direct measure of how
# well the geometry is doing. A healthy result is a fraction of a percent,
# concentrated on boundaries.

msg("Validating against eBird's own STATE CODE")

assigned <- pts[!is.na(mun_nr) & ebird_region != ""]
modal <- assigned[, .N, by = .(mun_slug, ebird_region)]
data.table::setorder(modal, mun_slug, -N)
modal_region <- modal[, .SD[1], by = mun_slug][, .(mun_slug, region = ebird_region)]

assigned <- merge(assigned, modal_region, by = "mun_slug")
mismatch <- assigned[ebird_region != region]

rate <- 100 * nrow(mismatch) / nrow(assigned)
msg("  ", nrow(mismatch), " / ", format(nrow(assigned), big.mark = ","),
    " localities disagree with their municipality's modal region (",
    sprintf("%.2f%%", rate), ")")

if (nrow(mismatch)) {
  worst <- mismatch[, .N, by = .(mun_slug, mun_name, got = ebird_region, expected = region)]
  data.table::setorder(worst, -N)
  msg("  worst offenders:")
  for (i in seq_len(min(6, nrow(worst)))) {
    msg("    ", worst$mun_name[i], ": ", worst$N[i],
        " localities say ", worst$got[i], ", municipality is ", worst$expected[i])
  }
}
if (rate > 2) warning("Region mismatch rate above 2% -- inspect before continuing.")

# Carry the municipality's region through; it is what the "open in eBird"
# species links need.
pts <- merge(pts, modal_region, by = "mun_slug", all.x = TRUE)
pts[is.na(region), region := ""]

# ---- 5b. postal area within the municipality --------------------------------
# The fourth level. The municipality assignment above is the source of truth, so
# an area is only ever chosen from among that municipality's own areas -- an
# area can never contradict the municipality it sits under. Coastal points that
# fall outside every polygon take the nearest area of their municipality, the
# same way they took the nearest municipality.

msg("Assigning localities to postal areas")

areas <- readRDS(file.path(WORK_DIR, "areas.rds"))
pts[, area_id := NA_character_]
pts[, area_placement := NA_character_]

sfpts_all <- sf::st_as_sf(pts, coords = c("lon", "lat"), crs = CRS_WGS84, remove = FALSE)
sfpts_all <- sf::st_transform(sfpts_all, CRS_ISN93)

for (s in unique(pts$mun_slug)) {
  rows <- which(pts$mun_slug == s)
  sub <- areas[areas$slug == s, ]
  if (!nrow(sub)) next                      # Hafsvaedi has no polygon
  p <- sfpts_all[rows, ]
  hit <- sf::st_intersects(p, sub)
  got <- lengths(hit) > 0
  idx <- rep(NA_integer_, length(rows))
  idx[got] <- vapply(hit[got], `[`, integer(1), 1)
  if (any(!got)) idx[!got] <- sf::st_nearest_feature(p[!got, ], sub)
  pts[rows, `:=`(
    area_id = sub$area_id[idx],
    area_placement = ifelse(got, "inside", "nearest")
  )]
}

placed <- pts[!is.na(area_id)]
msg("  ", format(nrow(placed), big.mark = ","), " of ",
    format(nrow(pts), big.mark = ","), " localities placed in an area (",
    sprintf("%.1f%%", 100 * nrow(placed) / nrow(pts)), ")")
msg("    inside a polygon: ", format(placed[area_placement == "inside", .N], big.mark = ","),
    " | nearest fallback: ", format(placed[area_placement == "nearest", .N], big.mark = ","))
msg("  unplaced (Hafsvaedi, no polygon): ", pts[is.na(area_id), .N])

# The whole point of intersecting the two layers: this must be zero.
area_mun <- stats::setNames(areas$slug, areas$area_id)
bad <- placed[unname(area_mun[area_id]) != mun_slug]
if (nrow(bad)) {
  stop(nrow(bad), " localities were given an area outside their municipality")
}
msg("  every area agrees with its municipality  OK")

# ---- 6. write ---------------------------------------------------------------

out_cols <- c("loc_id", "loc_name", "loc_type", "lat", "lon",
              "ebird_region", "mun_slug", "mun_name", "mun_nr", "region",
              "placement", "offshore", "dist_m", "area_id", "area_placement")
res <- pts[, ..out_cols]
data.table::setkey(res, loc_id)

saveRDS(res, file.path(WORK_DIR, "locality_municipality.rds"))
data.table::fwrite(res, file.path(WORK_DIR, "locality_municipality.csv"))
msg("  wrote work/locality_municipality.{rds,csv}")

# ---- 7. spot checks ---------------------------------------------------------

msg("Spot checks:")
spot <- c("Tjörnin", "Kaldbakstjarnir", "Mývatn", "Garðskagi",
          "Látrabjarg", "Eldey")
for (s in spot) {
  m <- res[grepl(s, loc_name, fixed = TRUE)][order(-(loc_type == "H"))][1]
  if (nrow(m) && !is.na(m$loc_id)) {
    msg("    ", formatC(substr(m$loc_name, 1, 34), width = -36),
        " -> ", formatC(m$mun_name, width = -22),
        " (", m$placement, if (m$dist_m > 0) paste0(", ", m$dist_m, " m") else "", ")")
  }
}

invisible(res)
