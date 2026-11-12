const COLUMNS = ['url', 'type', 'title', 'description', 'author', 'publishedAt', 'siteName', 'lang', 'canonical', 'image', 'source', 'status', 'ok', 'error'];

function cell(value) {
  if (value === undefined || value === null) return '';
  let s = String(value);
  // A leading = + - @ makes spreadsheets run the cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records) {
  const rows = [COLUMNS.join(',')];
  for (const r of records) rows.push(COLUMNS.map((c) => cell(r[c])).join(','));
  return `${rows.join('\n')}\n`;
}
