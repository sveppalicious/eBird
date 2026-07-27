# 00_config.R -- paths and counting rules for the Iceland sveitarfelag explorer.
# Everything the rest of the pipeline treats as a policy decision lives here.

suppressPackageStartupMessages({
  library(data.table)
})

# Rscript defaults to the C locale on this machine, which mangles Icelandic
# names. Ask for UTF-8; if the platform refuses, we still survive because every
# non-ASCII literal below is written as a \u escape rather than a raw character.
suppressWarnings({
  ok <- Sys.setlocale("LC_CTYPE", "en_US.UTF-8")
  if (!nzchar(ok)) Sys.setlocale("LC_CTYPE", "UTF-8")
})

# ---- paths ------------------------------------------------------------------

# Run the scripts from the project root (run_all.R does). If R/ is not visible
# from the working directory we are in the wrong place and should say so loudly.
PROJ_DIR <- normalizePath(getwd())
if (!dir.exists(file.path(PROJ_DIR, "R"))) {
  stop("Run these scripts from the project root (the directory containing R/). ",
       "Currently in: ", PROJ_DIR)
}

EBD_RELEASE <- "relJun-2026"
EBD_DIR     <- file.path(PROJ_DIR, sprintf("ebd_IS_unv_smp_%s", EBD_RELEASE))

EBD_OBS_FILE      <- file.path(EBD_DIR, sprintf("ebd_IS_unv_smp_%s.txt", EBD_RELEASE))
EBD_SAMPLING_FILE <- file.path(EBD_DIR, sprintf("ebd_IS_unv_smp_%s_sampling.txt", EBD_RELEASE))
EBD_UNVETTED_FILE <- file.path(EBD_DIR, sprintf("ebd_IS_unv_smp_%s_unvetted.txt", EBD_RELEASE))
EBD_CITATION_FILE <- file.path(EBD_DIR, "recommended_citation.txt")

WORK_DIR <- file.path(PROJ_DIR, "work")
SITE_DIR <- file.path(PROJ_DIR, "site")
DATA_DIR <- file.path(SITE_DIR, "data")
GEO_DIR  <- file.path(DATA_DIR, "geo")
MUN_DIR  <- file.path(DATA_DIR, "mun")

for (d in c(WORK_DIR, DATA_DIR, GEO_DIR, MUN_DIR)) {
  if (!dir.exists(d)) dir.create(d, recursive = TRUE)
}

# ---- external sources -------------------------------------------------------

# Landmaelingar Islands, IS 50V. `mork_sveitarf_svaedi` is the dissolved layer:
# one feature per municipality. (`mork_sveitarf_flakar` is the same data split
# into polygon parts -- 68 features for 61 municipalities.)
LMI_WFS_URL <- paste0(
  "https://gis.lmi.is/geoserver/wfs",
  "?service=WFS&version=2.0.0&request=GetFeature",
  "&typeNames=IS_50V:mork_sveitarf_svaedi",
  "&outputFormat=application/json",
  "&srsName=EPSG:4326"
)

# Postal areas, the fourth level. Byggdastofnun/LMI, served from the same WFS.
POSTAL_WFS_URL <- paste0(
  "https://gis.lmi.is/geoserver/wfs",
  "?service=WFS&version=2.0.0&request=GetFeature",
  "&typeNames=byggdastofnun:postnumer",
  "&outputFormat=application/json",
  "&srsName=EPSG:4326"
)

# Named neighbourhoods. The `tlsv` level of Hagstofa's small-area geography is
# the only official source of real Icelandic neighbourhood names -- "Reykjavik:
# Midborg", "Arbaer", "Vesturbaer sudur". It only subdivides the capital area
# and Akureyri, which is why postal codes remain the fallback everywhere else.
SMASVAEDI_WFS_URL <- paste0(
  "https://gis.lmi.is/geoserver/wfs",
  "?service=WFS&version=2.0.0&request=GetFeature",
  "&typeNames=Hagstofan:smasvaedi_2021",
  "&outputFormat=application/json",
  "&srsName=EPSG:4326"
)

# Municipal, postal and statistical boundaries come from three different
# agencies and disagree by a few metres in places. Intersecting them throws off
# slivers that hold no localities; anything smaller than this is discarded.
SLIVER_KM2 <- 0.05

# A neighbourhood must also cover at least this share of its municipality to
# count. Absolute size alone is not enough: the disagreement between LMI's
# municipal outline and Hagstofa's puts a sliver of "Kopavogur: Vatnsendi"
# inside Reykjavikurborg, and a phantom second area inside Akranes. Both would
# otherwise make their municipality look subdivided when it is not.
NAMED_MIN_SHARE <- 0.01

# eBird taxonomy API. Works without an API key for this endpoint.
EBIRD_TAXONOMY_URL <- "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&locale=%s"

# ---- projections ------------------------------------------------------------

CRS_WGS84 <- 4326
CRS_ISN93 <- 3057   # metres; correct for distance work in Iceland

# ---- counting rules ---------------------------------------------------------
# These reproduce how eBird itself counts "Species observed".

# Rolled up to the parent species by auk_rollup(), then counted.
COUNTABLE_CATEGORIES <- c("species", "issf", "form", "intergrade")

# Kept in the data but never numbered -- eBird lists these below the species.
NONCOUNTABLE_CATEGORIES <- c("spuh", "slash", "hybrid", "domestic")

# Exotic codes: N = naturalised, P = provisional (both countable);
# X = escapee, which eBird does not count.
EXCLUDE_EXOTIC <- "X"

# The main EBD file is already APPROVED=1 throughout; the unvetted records ship
# in a separate small file. Off by default.
INCLUDE_UNVETTED <- FALSE

# ---- spatial assignment tiers (metres) --------------------------------------
# Points that fall outside every polygon are assigned to the nearest one if
# they are close enough. See 03_assign_localities.R.

NEAR_SHORE_M <- 2000     # coastal jitter / harbours / shoreline generalisation
OFFSHORE_M   <- 30000    # boat trips, bird islands, ferry legs -- assigned but flagged
# Beyond OFFSHORE_M the locality goes to the pseudo-municipality below.

OPEN_SEA_SLUG <- "0000-hafsvaedi"
OPEN_SEA_NAME <- "Hafsv\u00e6\u00f0i"   # "Hafsvaedi" -- open sea

# ---- eBird link builders ----------------------------------------------------
# Verified against the live site; see README.

ebird_checklist_url <- function(sub) sprintf("https://ebird.org/checklist/%s", sub)
ebird_hotspot_url   <- function(loc) sprintf("https://ebird.org/hotspot/%s", loc)

# eBird profile URLs use base64 of the numeric part of the observer id:
# obsr939641 -> OTM5NjQx
ebird_observer_token <- function(obsr) {
  num <- sub("^obsr", "", obsr)
  vapply(num, function(x) jsonlite::base64_enc(charToRaw(x)), character(1),
         USE.NAMES = FALSE)
}

# ---- small helpers ----------------------------------------------------------

`%||%` <- function(a, b) if (is.null(a)) b else a

msg <- function(...) cat(format(Sys.time(), "[%H:%M:%S] "), ..., "\n", sep = "")

# Icelandic name -> URL-safe ascii. Used for municipality slugs and for the
# neighbourhood codes that appear in area URLs.
slugify <- function(name) {
  ascii <- name
  # Written as escapes so the file parses identically in a C locale.
  from <- c("\u00e1","\u00f0","\u00e9","\u00ed","\u00f3","\u00fa","\u00fd",
            "\u00fe","\u00e6","\u00f6",
            "\u00c1","\u00d0","\u00c9","\u00cd","\u00d3","\u00da","\u00dd",
            "\u00de","\u00c6","\u00d6")
  to   <- c("a","d","e","i","o","u","y","th","ae","o",
            "a","d","e","i","o","u","y","th","ae","o")
  for (i in seq_along(from)) ascii <- gsub(from[i], to[i], ascii, fixed = TRUE)
  ascii <- tolower(ascii)
  ascii <- gsub("[^a-z0-9]+", "-", ascii)
  gsub("(^-|-$)", "", ascii)
}

# Slug from the official municipality number + a transliterated name, so the
# key survives renames. Mergers change the number, and that is intended.
make_slug <- function(nr, name) {
  # Zero-pad: Reykjavik's official number really is 0000.
  sprintf("%04d-%s", as.integer(nr), slugify(name))
}
