// csv.js -- the reader a user's own eBird export goes through.

// eBird's export quotes any field containing a comma, a quote or a newline --
// Observation Details and Checklist Comments routinely do, and a real export
// had 3,236 quote characters. Splitting on commas mangles those rows, so this
// is a proper RFC4180 reader: "" is an escaped quote, and newlines inside
// quotes do not end the record.
//
// Rows are returned at whatever width they were written. eBird drops trailing
// empty fields rather than padding, so a 23-column header is followed by rows
// of 16 to 23 fields; requiring full width once discarded 98% of a real file.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export { parseCSV };
