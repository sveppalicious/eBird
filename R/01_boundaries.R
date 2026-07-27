# 01_boundaries.R -- fetch current sveitarfelag polygons from Landmaelingar Islands.
#
# Produces:
#   work/sveitarfelog.rds        full precision, ISN93 (metres), for point-in-polygon
#   site/data/geo/sveitarfelog.json  simplified WGS84 GeoJSON for the SVG choropleth

source("R/00_config.R")

suppressPackageStartupMessages({
  library(sf)
  library(jsonlite)
})

sf::sf_use_s2(FALSE)  # planar ops in ISN93; s2 is not wanted here

msg("Fetching municipality boundaries from LMI WFS")

raw_path <- file.path(WORK_DIR, "lmi_sveitarfelog_raw.geojson")
if (!file.exists(raw_path)) {
  utils::download.file(LMI_WFS_URL, raw_path, quiet = TRUE, mode = "wb")
}
mun_wgs <- sf::st_read(raw_path, quiet = TRUE)

msg("  ", nrow(mun_wgs), " features returned")
stopifnot(nrow(mun_wgs) > 50, "sveitarfelag" %in% names(mun_wgs))

# The LMI dataset version travels in the `gagnasafn` attribute, e.g.
# "IS 50V, utgafa 06.07.2026". Record it so meta.json can report provenance.
lmi_version <- unique(as.character(mun_wgs$gagnasafn))[1]
msg("  LMI dataset: ", lmi_version)

mun <- mun_wgs[, c("sveitarfelag", "nrsveitarfelags")]
names(mun)[1:2] <- c("name", "nr")
mun$nr <- as.integer(mun$nr)

# NOTE: the layer also carries `stjornsyslusvaedi`, which reads as if it were an
# administrative-area code, but LMI sets it to 4 for every municipality. It is
# useless for mapping municipalities onto eBird regions, so the eBird region is
# derived empirically from the data in 03_assign_localities.R instead.

# GDAL hands back UTF-8 bytes but R leaves them unmarked in a C locale, which
# makes gsub() on the names fail. Mark them explicitly.
mun$name <- enc2utf8(as.character(mun$name))
Encoding(mun$name) <- "UTF-8"

# Guard against the layer silently changing to the split-polygon variant.
if (anyDuplicated(mun$nr)) {
  dup <- mun$nr[duplicated(mun$nr)]
  msg("  NOTE: dissolving ", length(unique(dup)), " duplicated municipality numbers")
  mun <- stats::aggregate(mun["name"], by = list(nr = mun$nr), FUN = function(x) x[1])
  stop("Unexpected duplicate municipality numbers -- check the WFS layer name.")
}

mun$slug <- make_slug(mun$nr, mun$name)
mun <- mun[order(mun$nr), ]

msg("  ", nrow(mun), " municipalities, numbers ",
    min(mun$nr), "-", max(mun$nr))

# ---- full precision, projected ---------------------------------------------

mun_isn93 <- sf::st_transform(mun, CRS_ISN93)
mun_isn93 <- sf::st_make_valid(mun_isn93)
mun_isn93$area_km2 <- round(as.numeric(sf::st_area(mun_isn93)) / 1e6, 1)

attr(mun_isn93, "lmi_version") <- lmi_version
saveRDS(mun_isn93, file.path(WORK_DIR, "sveitarfelog.rds"))
msg("  wrote work/sveitarfelog.rds")

# ---- simplified for the browser --------------------------------------------
# Simplify in metres, then go back to WGS84 and round. 200 m is well below what
# is visible on a country-wide choropleth but keeps fjords recognisable.

# Simplifying and rounding both collapse the smallest rings into lines. Those
# survive inside a MULTIPOLYGON in R, but OGR splits them back out on write and
# the feature lands in the GeoJSON as a GEOMETRYCOLLECTION the browser cannot
# draw. So do the simplify, the rounding and the cleanup all in ISN93, where
# st_area() works without lwgeom, and only then transform.
#
# Cleaning is per feature: st_collection_extract() over the whole layer would
# explode 61 municipalities into ~2,300 single-polygon rows.
clean_multipolygon <- function(g) {
  g <- sf::st_make_valid(g)
  if (grepl("COLLECTION", as.character(sf::st_geometry_type(g)), fixed = TRUE)) {
    g <- sf::st_collection_extract(g, "POLYGON")
  }
  parts <- suppressWarnings(sf::st_cast(g, "POLYGON"))
  parts <- parts[as.numeric(sf::st_area(parts)) > 0]
  sf::st_cast(sf::st_combine(parts), "MULTIPOLYGON")
}

simp <- sf::st_simplify(mun_isn93, dTolerance = 200, preserveTopology = TRUE)
# 10 m grid -- deliberately coarser than the 5 decimal degrees (~1 m) written
# below, so the write-time rounding has nothing left to collapse. Harmless
# alongside a 200 m simplification.
simp <- sf::st_set_precision(simp, 0.1)

geoms <- lapply(seq_len(nrow(simp)), function(i) clean_multipolygon(sf::st_geometry(simp)[i]))
sf::st_geometry(simp) <- sf::st_sfc(do.call(c, geoms), crs = sf::st_crs(simp))

stopifnot(
  nrow(simp) == nrow(mun_isn93),
  all(as.character(sf::st_geometry_type(simp)) == "MULTIPOLYGON")
)

simp <- sf::st_transform(simp, CRS_WGS84)

geo_path <- file.path(GEO_DIR, "sveitarfelog.json")
sf::st_write(
  simp[, c("slug", "name", "nr", "area_km2")],
  geo_path,
  driver = "GeoJSON",
  delete_dsn = TRUE,
  # No RFC7946=YES: the only thing its ring rewinding buys us is correct hole
  # rendering under SVG's default nonzero fill rule, and map.js uses evenodd,
  # which does not care about winding.
  layer_options = c("COORDINATE_PRECISION=5"),
  quiet = TRUE
)

# Verify what was actually written, not what was in memory: OGR is the step that
# turns degenerate rings into geometry the browser cannot draw.
written <- sf::st_read(geo_path, quiet = TRUE)
wtypes <- table(as.character(sf::st_geometry_type(written)))
stopifnot(nrow(written) == nrow(mun))
if (!all(names(wtypes) %in% c("POLYGON", "MULTIPOLYGON"))) {
  stop("GeoJSON contains non-polygonal geometry: ",
       paste(names(wtypes), wtypes, collapse = ", "))
}

msg("  wrote ", geo_path, " (",
    round(file.info(geo_path)$size / 1024), " KB, ",
    paste(names(wtypes), wtypes, sep = " x ", collapse = ", "), ")")

invisible(mun_isn93)
