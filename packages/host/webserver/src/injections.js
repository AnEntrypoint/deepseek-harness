function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function assertNever(row) {
  throw new Error(`webserver: unknown index injection row ${JSON.stringify(row)}`)
}

function renderRow(row) {
  switch (row.kind) {
    case 'global': {
      // `<` is escaped in JSON so a row-controlled string cannot break out of
      // the script element.
      const name = JSON.stringify(row.name).replaceAll('<', '\\u003c')
      const value = row.value === undefined
        ? 'undefined'
        : JSON.stringify(row.value).replaceAll('<', '\\u003c')
      return { placement: 'head', markup: `<script>globalThis[${name}] = ${value}</script>` }
    }
    case 'script':
      return { placement: row.placement, markup: `<script>${row.text}</script>` }
    case 'script-src':
      return { placement: row.placement, markup: `<script src="${escapeHtmlAttribute(row.src)}"></script>` }
    case 'style':
      return { placement: 'head', markup: `<style>${row.text}</style>` }
    case 'html':
      return { placement: row.placement, markup: row.html }
    default:
      return assertNever(row)
  }
}

function splice(html, at, markup) {
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}

export function renderIndexInjections(html, rows) {
  let head = ''
  let body = ''
  for (const row of rows) {
    const rendered = renderRow(row)
    if (rendered.placement === 'head') head += rendered.markup
    else body += rendered.markup
  }
  let out = html
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out)
    // Headless fixture pages may lack <head>; prepending keeps the rows ahead
    // of every document script.
    out = open === null ? `${head}${out}` : splice(out, open.index + open[0].length, head)
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out)
    // Body-less fragments receive the rows at the end, where the HTML parser
    // has already synthesized a body.
    out = open === null ? `${out}${body}` : splice(out, open.index + open[0].length, body)
  }
  return out
}
