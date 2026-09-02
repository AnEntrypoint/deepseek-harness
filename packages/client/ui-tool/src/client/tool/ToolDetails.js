/** Card-aware output body for the selected Tool call in details. */
import { createElement as h, Fragment } from 'webjsx'
import { DiffBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@freddie/freddie-client-ui-primitives'
import { diffCardModel } from './models/diff-card-model.js'
import { readCardModel } from './models/read-card-model.js'
import { searchCardModel } from './models/search-card-model.js'
import { terminalBlockLabels, terminalCardModel } from './models/terminal-card-model.js'
import { resultText } from './models/tool-call-model.js'
import { webCardModel } from './models/web-card-model.js'
import css from './ToolDetails.css.js'

/**
 * Render the selected Tool call's structured output when its presentation
 * intent is known, otherwise preserve the flattened result text.
 * @param props - selected call slice, workspace root, host home, and locale seat.
 * @returns the details output body.
 */
export function ToolDetails({
  block, cwd, useHostDescription, t,
}) {
  const home = useHostDescription(description => description?.home)
  const terminal = terminalCardModel(block, cwd)
  if (terminal !== null) {
    return [
      terminal.description !== undefined ? (
        h('div', {class: css.description ?? ''}, terminal.description)
      ) : null,
      h(TerminalBlock, {...terminal.card, labels: terminalBlockLabels(t), className: css.cardBody}),
    ]
  }
  const read = readCardModel(block, cwd, home)
  if (read !== null) return h(ReadBlock, {...read, className: css.read})
  const diff = diffCardModel(block)
  if (diff !== null) return h(DiffBlock, {...diff.card, className: css.cardBody})
  const search = searchCardModel(block)
  if (search !== null) {
    return [
      h(SearchBlock, {...search.card, className: css.cardBody}),
      search.recovery !== undefined ? h('div', {class: css.recovery ?? ''}, search.recovery) : null,
    ]
  }
  const web = webCardModel(block)
  if (web !== null) {
    const body = 'kind' in block ? resultText(block) : ''
    return [
      h(WebBlock, {...web, className: css.web}),
      body !== '' ? h('pre', {class: css.code ?? ''}, body) : null,
    ]
  }
  if (!('kind' in block)) return h('div', {class: css.empty ?? ''}, t('details.running'))
  return (
    h('pre', {class: css.code ?? '', 'data-error': block.isError || undefined},
      resultText(block)
    )
  )
}
