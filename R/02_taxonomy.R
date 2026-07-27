# 02_taxonomy.R -- eBird taxonomy with both Icelandic and English common names.
#
# The EBD only carries English common names. The eBird taxonomy API serves the
# Icelandic ones (and the speciesCode we need for ebird.org/species/ links),
# and this endpoint does not require an API key.
#
# Produces:
#   work/taxonomy.rds
#   site/data/taxonomy.json

source("R/00_config.R")

suppressPackageStartupMessages({
  library(jsonlite)
})

fetch_taxonomy <- function(locale) {
  path <- file.path(WORK_DIR, sprintf("ebird_taxonomy_%s.json", locale))
  if (!file.exists(path)) {
    msg("  downloading taxonomy (locale=", locale, ")")
    utils::download.file(sprintf(EBIRD_TAXONOMY_URL, locale), path,
                         quiet = TRUE, mode = "wb")
  }
  jsonlite::fromJSON(path, simplifyDataFrame = TRUE)
}

msg("Fetching eBird taxonomy")

tax_en <- fetch_taxonomy("en")
tax_is <- fetch_taxonomy("is")

stopifnot(nrow(tax_en) > 10000, nrow(tax_is) == nrow(tax_en))
msg("  ", nrow(tax_en), " taxa")

tax <- data.table(
  speciesCode = tax_en$speciesCode,
  sci         = tax_en$sciName,
  en          = tax_en$comName,
  taxonOrder  = as.numeric(tax_en$taxonOrder),
  category    = tax_en$category,
  order       = tax_en$order,
  familyCode  = tax_en$familyCode,
  family      = tax_en$familyComName,
  # reportAs is the parent species an issf/form/intergrade rolls up into.
  # Absent for full species; NA there.
  reportAs    = if ("reportAs" %in% names(tax_en)) tax_en$reportAs else NA_character_
)

is_names <- data.table(speciesCode = tax_is$speciesCode, is = tax_is$comName)
tax <- merge(tax, is_names, by = "speciesCode", all.x = TRUE, sort = FALSE)

# Where eBird has no Icelandic name (most non-Icelandic vagrants and all the
# spuh/slash placeholders) the API echoes the English name back. Detect that so
# the UI can style untranslated names differently rather than pretending.
tax[, has_is := !is.na(is) & is != en]

setorder(tax, taxonOrder)

msg("  ", sum(tax$has_is), " taxa have a distinct Icelandic name")

saveRDS(tax, file.path(WORK_DIR, "taxonomy.rds"))

# The site only needs the taxa that actually occur in the Iceland EBD, but this
# script runs before the EBD is read. Write the full table now; 05_export_json.R
# subsets it. ~17k rows is ~2 MB, so subsetting matters.
jsonlite::write_json(
  tax, file.path(DATA_DIR, "taxonomy_full.json"),
  auto_unbox = TRUE, na = "null"
)

msg("  wrote work/taxonomy.rds and site/data/taxonomy_full.json")

invisible(tax)
