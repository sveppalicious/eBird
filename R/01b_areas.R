# 01b_areas.R -- the fourth level: named neighbourhoods where they exist,
# postal areas everywhere else.
#
# Two national layers are candidates, and neither is sufficient alone:
#
#   Hagstofa `tlsv`   real neighbourhood names -- "Reykjavik: Midborg",
#                     "Arbaer", "Vesturbaer sudur" -- but it only subdivides
#                     five municipalities. Outside the capital it is *coarser*
#                     than a sveitarfelag: one of its areas merges Mosfellsbaer
#                     with Kjos, another covers the whole of Vestfirdir.
#   postnumer         no names, but subdivides 45 of 61 municipalities.
#
# So each municipality gets whichever fits: named areas if the neighbourhood
# layer genuinely splits it, postal codes otherwise.
#
# Either way an area is the *intersection* of the municipality with the chosen
# layer, never the layer polygon itself. The agencies' outlines disagree by
# metres, so intersecting is what makes nesting true by construction: every
# area lies wholly inside one sveitarfelag.
#
# Produces:
#   work/areas.rds              full precision, ISN93
#   site/data/geo/areas.json    simplified WGS84, for the maps

source("R/00_config.R")

suppressPackageStartupMessages({
  library(sf)
  library(jsonlite)
})

sf::sf_use_s2(FALSE)

fetch_layer <- function(url, file) {
  path <- file.path(WORK_DIR, file)
  if (!file.exists(path)) utils::download.file(url, path, quiet = TRUE, mode = "wb")
  sf::st_read(path, quiet = TRUE)
}

utf8 <- function(x) { x <- enc2utf8(as.character(x)); Encoding(x) <- "UTF-8"; x }

msg("Fetching postal and neighbourhood layers")

pn <- fetch_layer(POSTAL_WFS_URL, "postnumer_raw.geojson")
pn$stadur <- utf8(pn$stadur)
pn <- pn[, c("postnumer", "stadur")]
pn$postnumer <- as.integer(pn$postnumer)
pn <- sf::st_make_valid(sf::st_transform(pn, CRS_ISN93))

sm <- fetch_layer(SMASVAEDI_WFS_URL, "smasvaedi_raw.geojson")
sm$tlsv_label <- utf8(sm$tlsv_label)
sm <- sf::st_make_valid(sf::st_transform(sm[, c("tlsv", "tlsv_label")], CRS_ISN93))

# Hagstofa's small areas are the finest cut; the neighbourhoods we want are
# their `tlsv` parent, so dissolve up to it.
hv <- stats::aggregate(sm["tlsv_label"], by = list(tlsv = sm$tlsv),
                       FUN = function(x) x[1], do_union = TRUE)
hv$tlsv_label <- utf8(hv$tlsv_label)
msg("  ", nrow(pn), " postal codes | ", nrow(hv), " neighbourhood areas")

mun <- readRDS(file.path(WORK_DIR, "sveitarfelog.rds"))

# ---- helpers ----------------------------------------------------------------

# Intersect one municipality with a layer and return the surviving parts,
# keyed by `key_col`. Parts below `min_km2` are dropped: they are boundary
# disagreement, not real subdivision.
parts_for <- function(m, layer, key_col, min_km2) {
  x <- suppressWarnings(sf::st_intersection(m, layer))
  if (!nrow(x)) return(NULL)
  x <- sf::st_make_valid(x)
  x <- x[!sf::st_is_empty(x), ]
  if (!nrow(x)) return(NULL)
  x <- suppressWarnings(sf::st_collection_extract(x, "POLYGON"))
  if (!nrow(x)) return(NULL)
  x$part_km2 <- as.numeric(sf::st_area(x)) / 1e6
  x <- x[x$part_km2 >= min_km2, ]
  if (!nrow(x)) return(NULL)
  x$.key <- as.character(sf::st_drop_geometry(x)[[key_col]])
  x
}

# Union the parts sharing a key into one MULTIPOLYGON per area.
combine_parts <- function(x) {
  ix <- split(seq_len(nrow(x)), x$.key)
  geoms <- lapply(ix, function(i)
    sf::st_cast(sf::st_union(sf::st_geometry(x)[i]), "MULTIPOLYGON"))
  list(keys = names(ix),
       km2 = vapply(ix, function(i) sum(x$part_km2[i]), numeric(1)),
       geom = sf::st_sfc(do.call(c, geoms), crs = CRS_ISN93))
}

# "Reykjavik: Midborg" -> "Midborg". The sveitarfelag is already in the heading
# and the breadcrumb, so repeating it on every row is noise.
strip_prefix <- function(x) sub("^[^:]*:\\s*", "", x)

# ---- which municipality owns each neighbourhood ------------------------------
# A neighbourhood belongs to whichever municipality holds most of it. This is
# what removes boundary bleed, and it does so without a size threshold: a
# threshold relative to the municipality cannot work, because Reykjavikurborg is
# 244 km2 of which Kjalarnes is more than half, so 1% of it would discard
# Midborg, Hlidar and every other small dense neighbourhood.
#
# Judging each neighbourhood by how much of *itself* lies in the municipality is
# scale-free: Midborg is ~100% inside Reykjavik, whereas the stray slice of
# "Kopavogur: Vatnsendi" is a fraction of a percent.

msg("Attributing neighbourhoods to municipalities")

hv$hv_km2 <- as.numeric(sf::st_area(hv)) / 1e6
ov <- suppressWarnings(sf::st_intersection(mun[, "slug"], hv))
ov <- ov[!sf::st_is_empty(ov), ]
ov <- suppressWarnings(sf::st_collection_extract(ov, "POLYGON"))
ov$share <- (as.numeric(sf::st_area(ov)) / 1e6) / ov$hv_km2

share <- stats::aggregate(ov["share"], by = list(slug = ov$slug, tlsv = ov$tlsv),
                          FUN = sum)
share <- sf::st_drop_geometry(share)
share <- share[order(share$tlsv, -share$share), ]
owner <- share[!duplicated(share$tlsv), ]          # dominant municipality
named_by_mun <- split(owner$tlsv, owner$slug)

# ---- per municipality: choose a layer ---------------------------------------

msg("Choosing a layer per municipality")

rows <- list()
n_named <- 0L

for (i in seq_len(nrow(mun))) {
  m <- mun[i, c("slug", "name", "nr")]
  own <- named_by_mun[[m$slug]]

  named <- if (length(own) >= 2)
    parts_for(m, hv[hv$tlsv %in% own, ], "tlsv_label", SLIVER_KM2) else NULL
  use_named <- !is.null(named) && length(unique(named$.key)) >= 2

  if (use_named) {
    cb <- combine_parts(named)
    kind <- "hverfi"
    label <- strip_prefix(cb$keys)
    code <- slugify(label)
    postnumer <- rep(NA_integer_, length(cb$keys))
    n_named <- n_named + 1L
  } else {
    postal <- parts_for(m, pn, "postnumer", SLIVER_KM2)
    if (is.null(postal)) next
    cb <- combine_parts(postal)
    kind <- "postnumer"
    pnum <- as.integer(cb$keys)
    stadur <- pn$stadur[match(pnum, pn$postnumer)]
    label <- paste(pnum, stadur)
    code <- as.character(pnum)
    postnumer <- pnum
  }

  rows[[length(rows) + 1]] <- sf::st_sf(
    data.frame(
      area_id   = sprintf("%s-%s", m$slug, code),
      slug      = m$slug,
      mun_name  = m$name,
      code      = code,
      label     = label,
      kind      = kind,
      postnumer = postnumer,
      area_km2  = round(unname(cb$km2), 2),
      stringsAsFactors = FALSE
    ),
    geometry = cb$geom
  )
}

areas <- do.call(rbind, rows)
areas <- areas[order(areas$slug, areas$code), ]

# A code must be unique inside its municipality, since it is the URL segment.
stopifnot(!anyDuplicated(areas$area_id))

msg("  ", nrow(areas), " areas across ", length(unique(areas$slug)), " municipalities")
msg("    named neighbourhoods: ", sum(areas$kind == "hverfi"), " in ", n_named,
    " municipalities")
msg("    postal areas:         ", sum(areas$kind == "postnumer"), " in ",
    length(unique(areas$slug[areas$kind == "postnumer"])), " municipalities")

sizes <- table(areas$slug)
msg("  municipalities with more than one area: ", sum(sizes > 1),
    " (max ", max(sizes), ")")
for (s in names(sizes)[sizes > 1][order(-as.integer(sizes[sizes > 1]))][1:6]) {
  a <- areas[areas$slug == s, ]
  msg("    ", a$mun_name[1], " (", a$kind[1], "): ",
      paste(utils::head(a$label, 4), collapse = ", "),
      if (nrow(a) > 4) sprintf(" ... +%d", nrow(a) - 4) else "")
}

saveRDS(areas, file.path(WORK_DIR, "areas.rds"))
msg("  wrote work/areas.rds")

# ---- simplified for the browser --------------------------------------------

clean_multipolygon <- function(g) {
  g <- sf::st_make_valid(g)
  if (grepl("COLLECTION", as.character(sf::st_geometry_type(g)), fixed = TRUE)) {
    g <- sf::st_collection_extract(g, "POLYGON")
  }
  parts <- suppressWarnings(sf::st_cast(g, "POLYGON"))
  parts <- parts[as.numeric(sf::st_area(parts)) > 0]
  if (!length(parts)) return(NULL)
  sf::st_cast(sf::st_combine(parts), "MULTIPOLYGON")
}

simp <- sf::st_simplify(areas, dTolerance = 120, preserveTopology = TRUE)
simp <- sf::st_set_precision(simp, 0.1)

geoms <- lapply(seq_len(nrow(simp)), function(i)
  clean_multipolygon(sf::st_geometry(simp)[i]))
keep <- !vapply(geoms, is.null, logical(1))
simp <- simp[keep, ]
sf::st_geometry(simp) <- sf::st_sfc(do.call(c, geoms[keep]), crs = sf::st_crs(simp))

stopifnot(all(as.character(sf::st_geometry_type(simp)) == "MULTIPOLYGON"))

simp <- sf::st_transform(simp, CRS_WGS84)

# `code` travels with the geometry so the front end can build an area URL from
# a clicked polygon without parsing the id.
geo_path <- file.path(GEO_DIR, "areas.json")
sf::st_write(simp[, c("area_id", "slug", "code", "label", "kind", "area_km2")],
             geo_path, driver = "GeoJSON", delete_dsn = TRUE,
             layer_options = c("COORDINATE_PRECISION=5"), quiet = TRUE)

written <- sf::st_read(geo_path, quiet = TRUE)
wtypes <- table(as.character(sf::st_geometry_type(written)))
if (!all(names(wtypes) %in% c("POLYGON", "MULTIPOLYGON"))) {
  stop("areas.json contains non-polygonal geometry: ",
       paste(names(wtypes), wtypes, collapse = ", "))
}

msg("  wrote ", geo_path, " (", round(file.info(geo_path)$size / 1024), " KB, ",
    nrow(written), " areas)")

invisible(areas)
