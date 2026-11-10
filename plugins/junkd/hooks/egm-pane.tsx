// egm: the `egm` settings group (enabled, models) and the egm tab (junkd-egm), the model registry
// ${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/models.json that /junkd:task-draft reads. The `$`-free parts are egm.ts (schema,
// validation, sort, state E) and egm-views.tsx (drawing). After the pattern of tools-pane.tsx.
// - enabled off: the tab closes and the /junkd set leaves it out (panel.tsx); on while the set is open, the tab opens
//   as the set's, without the keys. models works only with enabled on: a flip on while enabled is off is refused
//   (here for the pane, in the config.set hook for /config), and every reader treats it as off then.
// - Every show reads the file; a missing one is seeded (A haiku, B sonnet, C opus). A file that does not parse or
//   validate is never written: the tab draws its reason and refuses to add, edit or delete.
// - A write resolves a link, stays inside <config dir>/junkd/, goes through a temp file and keeps models.json.bak.
import type { HideInput, OpenInput, ShowInput, SetResult } from './feature'
import type { On, RenderInput } from 'claude-code'
import { SET_OWNER, type $ } from './feature'
import { isSets, setIsOpen, shutSet } from './set'
import { panelToggle } from './panel'
import { configKey, configKeys, fieldOf, groupOptions, keyOf } from './settings'
import {
  CLASSES, E, EFFORTS, HARNESSES, JSON_EXAMPLE, LEVELS, PASSES, SEED, coerce, coerceAnswers, editDraft, isDuplicate, newDraft, parseEntry, parseFile, resetEgm,
  serialize, sortEntries, type Entry,
} from './egm'
import { egmView, type EgmActs, type Els, type Field } from './egm-views'

export const EGM_PANE_ID = 'junkd-egm'
export const OFF_TEXT = 'junkd: the egm tab is off: /junkd → egm → enabled'
const MODELS_DENY = 'egm.models działa dopiero przy egm.enabled = on'
const FIX = 'popraw plik ręcznie'

let owner: string | undefined
let isOpen = false
let focused: string | undefined // the element of the tab that holds the focus ring, as ui.focus last said
const reason = (err: unknown) => (err as Error)?.message ?? String(err)
function redraw($: $) {
  return $.ui.invalidate('ui.render')
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself.
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}
const tilde = (path: string, h: string) => (h && path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path)
let shown = '~/.claude/junkd/models.json' // the file as the labels name it, ~ for HOME
async function paths($: $) {
  const cfg = await configDir($)
  const dir = `${cfg}/junkd`
  const file = `${dir}/models.json`
  shown = tilde(file, await homeDir($))
  return { cfg, dir, file }
}

// the registry file -------------------------------------------------------------------------------------------------

// One write after the other, on one chain (two at once would move a temp file the other already moved).
let writes: Promise<void> = Promise.resolve()
function writeRegistry($: $, list: readonly Entry[]): Promise<void> {
  const w = writes.then(() => writeNow($, list))
  writes = w.catch(() => undefined)
  return w
}
async function run($: $, argv: string[]) {
  const r = await $.process.run(argv)
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `${argv[0]} exited ${r.exitCode}`)
}
// Resolve the link (an existing file), make the folder, fence the target inside <cfg>/junkd/, write a temp file, keep
// the old file as .bak, move the temp file in. A failing step throws its reason and leaves models.json as it was.
async function writeNow($: $, list: readonly Entry[]): Promise<void> {
  const { cfg, dir, file } = await paths($)
  const linked = (await $.fs.stat(file, { resolve: true }).catch(() => undefined))?.realPath
  await run($, ['mkdir', '-p', '--', dir])
  const root = (await $.fs.stat(cfg, { resolve: true })).realPath
  const real = linked ?? `${(await $.fs.stat(dir, { resolve: true })).realPath}/models.json`
  if (!real.startsWith(`${root}/junkd/`)) throw new Error(`models.json wskazuje poza ${root}/junkd: ${real}`)
  const tmp = `${real}.junkd-tmp`
  await $.fs.write(tmp, serialize(list))
  if (linked !== undefined) await run($, ['/bin/cp', '-f', real, `${real}.bak`])
  await run($, ['/bin/mv', '-f', tmp, real])
}

// The file into E: missing, seeded; broken, its reason (and no list); good, the list sorted. Never throws.
async function loadRegistry($: $): Promise<void> {
  try {
    const { file } = await paths($)
    if (!(await $.fs.exists(file))) {
      await writeRegistry($, SEED)
      E.list = sortEntries(SEED)
      E.fileError = undefined
    } else {
      const r = parseFile(await $.fs.read(file))
      if ('error' in r) {
        E.list = []
        E.fileError = r.error
      } else {
        E.list = sortEntries(r.list)
        E.fileError = undefined
      }
    }
  } catch (err) {
    E.list = []
    E.fileError = `models.json: ${reason(err)}`
  }
  E.sel = Math.max(0, Math.min(E.sel, E.list.length - 1))
}

// The file as it is on disk now still parses: a write never replaces a file that went bad after the tab read it.
async function stillGood($: $): Promise<boolean> {
  const { file } = await paths($)
  if (!(await $.fs.exists(file))) return true
  const r = parseFile(await $.fs.read(file))
  if (!('error' in r)) return true
  E.list = []
  E.fileError = r.error
  return false
}

// Writes the new list (sorted). True when it landed; else the note is the reason and the list is read again.
async function commit($: $, list: readonly Entry[]): Promise<boolean> {
  const sorted = sortEntries(list)
  try {
    if (!(await stillGood($))) {
      E.note = `✗ ${E.fileError} · ${FIX}`
      return false
    }
    await writeRegistry($, sorted)
    E.list = sorted
    return true
  } catch (err) {
    E.note = `✗ ${reason(err)}`
    await loadRegistry($)
    return false
  }
}

// the tab's acts ----------------------------------------------------------------------------------------------------

// A broken file refuses every change, with its reason.
function refused(): boolean {
  if (E.fileError === undefined) return false
  E.note = `✗ ${E.fileError} · ${FIX}`
  return true
}
const sameRow = (a: Entry, b: Entry) => a.class === b.class && a.id === b.id && a.harness === b.harness

async function remove($: $) {
  if (refused() || E.list.length === 0) return
  const sel = Math.min(E.sel, E.list.length - 1)
  const gone = E.list[sel]!
  if (E.pendX !== sel) {
    E.pendX = sel
    E.note = `x jeszcze raz usuwa ${gone.id}`
    return
  }
  E.pendX = null
  if (await commit($, E.list.filter((_, i) => i !== sel))) E.note = `✓ usunięto ${gone.id}`
  E.sel = Math.max(0, Math.min(sel, E.list.length - 1))
}

async function save($: $) {
  const f = E.form
  if (!f) return
  const isJson = E.view === 'json'
  let r: ReturnType<typeof parseEntry>
  if (isJson) r = parseEntry(f.json)
  else {
    f.entry.id = f.idText.trim()
    if (f.entry.id === '') {
      E.note = '✗ id jest puste: wpisz id (b)'
      void $.ui.focus({ requestId: EGM_PANE_ID, key: 'egm-field:id' }).catch(() => undefined)
      return
    }
    r = parseEntry(f.entry)
  }
  if ('error' in r) {
    E.note = `✗ ${r.error}`
    return
  }
  const entry = r.entry
  if (isDuplicate(E.list, entry, f.editIndex)) {
    E.note = `✗ taki model już jest: ${entry.id} (klasa ${entry.class}, ${entry.harness})`
    return
  }
  const isEdit = f.editIndex !== null
  const list = isEdit ? E.list.map((e, i) => (i === f.editIndex ? entry : e)) : [...E.list, entry]
  if (!(await commit($, list))) return
  E.sel = Math.max(0, E.list.findIndex(e => sameRow(e, entry)))
  E.view = 'list'
  E.form = null
  E.pendX = null
  E.note = `✓ ${isEdit ? 'zapisano' : 'dodano'} ${entry.id} (klasa ${entry.class}) ${isJson ? 'z JSON ' : ''}w ${shown}`
}

// sposób: the entry goes along. To JSON: the current entry as JSON, or the example for a new one whose id is empty.
// Back to the form: the JSON's entry when it parses; else the form keeps what it had.
function setMode(m: 'form' | 'json') {
  const f = E.form
  if (!f || E.view === m) return
  if (m === 'json') {
    f.entry.id = f.idText.trim()
    f.json = f.editIndex === null && f.entry.id === '' ? JSON_EXAMPLE : JSON.stringify(f.entry)
  } else {
    const r = parseEntry(f.json)
    if ('entry' in r) {
      f.entry = r.entry
      f.idText = r.entry.id
    }
  }
  f.mode = m
  E.view = m
}

const OPTIONS: Record<Field, readonly string[]> = { class: CLASSES, harness: HARNESSES, effort: EFFORTS, thinking: LEVELS, pass: PASSES }
function pick(field: Field, value: string) {
  const f = E.form
  if (!f || !OPTIONS[field].includes(value)) return
  if (field === 'thinking') f.entry.thinking.level = value
  else if (field === 'pass') f.entry.thinking.pass = value
  else f.entry[field] = value
}
function cycle(field: Field) {
  const f = E.form
  if (!f) return
  const now = field === 'thinking' ? f.entry.thinking.level : field === 'pass' ? f.entry.thinking.pass : f.entry[field]
  const options = OPTIONS[field]
  pick(field, options[(options.indexOf(now) + 1) % options.length]!)
}

function acts($: $): EgmActs {
  // Every act but remove() drops a pending delete.
  const act = (fn: () => unknown) => () => {
    E.pendX = null
    void Promise.resolve(fn()).then(() => redraw($))
  }
  return {
    close: () => void (isSets(owner) ? shutSet($) : closePane($)),
    move: by => act(() => {
      E.sel = Math.max(0, Math.min(E.sel + by, E.list.length - 1))
      E.note = ''
    })(),
    select: index => act(() => {
      E.sel = Math.max(0, Math.min(index, E.list.length - 1))
    })(),
    edit: act(() => {
      if (refused() || E.list.length === 0) return
      const sel = Math.min(E.sel, E.list.length - 1)
      E.form = editDraft(E.list[sel]!, sel)
      E.view = 'form'
      E.note = ''
    }),
    remove: () => void remove($).then(() => redraw($)),
    add: act(() => {
      if (refused()) return
      E.form = newDraft()
      E.view = 'form'
      E.note = ''
    }),
    settings: act(async () => {
      if (setIsOpen()) await $.ui.focus({ requestId: 'junkd' }).catch(() => undefined) // a refused focus is no error
      else await panelToggle($)
    }),
    setMode: m => act(() => setMode(m))(),
    pick: (field, value) => act(() => pick(field, value))(),
    cycle: field => act(() => cycle(field))(),
    setId: text => act(() => {
      if (!E.form) return
      E.form.idText = text
      E.form.entry.id = text.trim()
      E.note = `✓ id = ${E.form.entry.id || '(puste)'}`
    })(),
    setJson: text => act(() => {
      if (E.form) E.form.json = text
    })(),
    save: act(() => save($)),
    cancel: act(() => {
      E.view = 'list'
      E.form = null
      E.note = 'anulowano'
    }),
    focus: key => void $.ui.focus({ requestId: EGM_PANE_ID, key }).catch(() => undefined), // a refused ring is no error
  }
}

// the pane ----------------------------------------------------------------------------------------------------------

// The pane is gone, whoever closed it: no owner, a fresh view next time.
function closed() {
  isOpen = false
  owner = undefined
  focused = undefined
  resetEgm()
}
// `$.ui.open` before any await: only an open made while the press or command runs counts as asked. The file is read
// right after; a refused open is no pane.
async function openPane($: $, focus: boolean) {
  const opened = $.ui.open({ id: EGM_PANE_ID, title: 'egm', focus: focus || undefined })
  owner = undefined
  isOpen = true
  const loaded = loadRegistry($).then(() => redraw($))
  try {
    await opened
  } catch (err) {
    closed()
    throw err
  }
  await loaded
}
// The engine does not raise our own `$.ui.close` to our ui.close hook, so the state is cleared here. The owner mark
// goes first: a close made inside another plugin's call (a /config write) can come back to that hook, and must not
// close the whole set.
async function closePane($: $) {
  owner = undefined
  await $.ui.close({ id: EGM_PANE_ID }).catch(() => undefined)
  closed()
}

// A value the row took lands in E. enabled on while the set is open opens the tab as the set's (no keys); off closes
// it wherever it is. answers only lands: the tab does not show it.
async function apply($: $, field: string, value: boolean | string): Promise<void> {
  if (field === 'answers') E.answers = coerceAnswers(value) ?? 'manual'
  else if (field === 'models') E.models = value === true
  else E.enabled = value === true
  if (field === 'enabled' && value === true && setIsOpen() && !isOpen) await egmShow($, { owner: SET_OWNER }).catch(() => undefined)
  if (field === 'enabled' && value === false) await closePane($)
  redraw($)
}

// A row's raw value as its field reads it: answers lowercased and checked against its options, a switch by coerce.
function read(field: string, raw: unknown): { value: boolean | string; deny?: undefined } | { deny: string; value?: undefined } {
  if (field !== 'answers') return { value: coerce(raw) }
  const v = coerceAnswers(raw)
  return v === undefined ? { deny: `junkd: ${String(raw)} is not a valid egm_answers (manual or auto)` } : { value: v }
}
const FIELDS = ['enabled', 'models', 'answers']

// what dispatch.ts, panel.tsx and index.tsx call ---------------------------------------------------------------------

// The stored value (the pill shows it, even while egm.models is dim); answers is its option.
export async function egmGet(_$: $, field: string): Promise<boolean | string> {
  return field === 'answers' ? E.answers : field === 'models' ? E.models : E.enabled
}
// The host sends this write past our own config.set hook, so the value is applied here.
export async function egmSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!FIELDS.includes(field)) return { deny: `junkd: no setting ${keyOf('egm', field)}` }
  const r = read(field, raw)
  if (r.deny !== undefined) return { deny: r.deny }
  const value = r.value
  if (field === 'models' && value === true && !E.enabled) return { deny: MODELS_DENY }
  const { deny } = await $.config.set({ key: configKey(keyOf('egm', field)), value })
  if (deny !== undefined) return { deny }
  await apply($, field, value)
  return { value }
}

// show opens the tab (reading the file) and never closes it; up already, it is asked again. `owner` marks it as that
// caller's, for hide. Off: refused with the reason.
export async function egmShow($: $, input: ShowInput = {}): Promise<void> {
  if (!E.enabled) throw new Error(OFF_TEXT)
  const opened = openPane($, input.focus === true)
  owner = input.owner
  await opened
}
// hide closes the tab; with `owner`, only while the tab is still the one that owner's show opened.
export async function egmHide($: $, input: HideInput = {}): Promise<void> {
  if (input.owner !== undefined && input.owner !== owner) return
  await closePane($)
}
// open toggles the tab. Off: refused with the reason.
export async function egmOpen($: $, _input: OpenInput = {}): Promise<void> {
  if (!E.enabled) throw new Error(OFF_TEXT)
  if (isOpen) return closePane($)
  return openPane($, true)
}

// A tab left open across a /reload-plugins reads the file again, or closes while off.
export async function egmStart($: $): Promise<void> {
  if (!(await $.ui.panes().catch(() => [])).some(p => p.id === EGM_PANE_ID)) return
  if (!E.enabled) return closePane($)
  isOpen = true
  await loadRegistry($)
  redraw($)
}

export function registerEgm(on: On, options: Record<string, unknown>): void {
  owner = undefined
  isOpen = false
  focused = undefined
  writes = Promise.resolve()
  resetEgm()
  const o = groupOptions(options, 'egm')
  E.enabled = coerce(o.enabled)
  E.models = coerce(o.models)
  E.answers = coerceAnswers(o.answers) ?? 'manual'

  // The /config menu's own writes to an egm row land here (a hook never sees its plugin's own `$.config.set`): read as
  // `set` reads it, refused where `set` refuses, applied once the row took it.
  on('config.set', { key: configKeys('egm') }, async ($, e, next) => {
    const field = fieldOf('egm', e.key)
    if (field === undefined || !FIELDS.includes(field)) return next(e)
    const v = read(field, e.value)
    if (v.deny !== undefined) return { deny: v.deny }
    const value = v.value
    if (field === 'models' && value === true && !E.enabled) return { deny: MODELS_DENY }
    const r = await next({ ...e, value })
    if (r?.deny === undefined) await apply($, field, value)
    return r
  })

  // The focus ring on a row's id Button makes that row the selection; another row drops a pending delete.
  on('ui.focus', { requestId: EGM_PANE_ID }, ($, e, next) => {
    focused = e.element
    if (e.element?.startsWith('egm-row-btn:')) {
      const n = Number(e.element.slice('egm-row-btn:'.length))
      if (Number.isInteger(n) && n >= 0 && n < E.list.length) {
        if (n !== E.sel) E.pendX = null
        E.sel = n
      }
    }
    redraw($)
    return next(e)
  })

  // The person's closes (q, ×) pass here; ours go through closePane.
  on('ui.close', { id: EGM_PANE_ID }, async ($, e, next) => {
    const isSet = isSets(owner)
    closed()
    const r = await next(e)
    if (isSet) await shutSet($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: EGM_PANE_ID }, ($, e: RenderInput<'Pane'>, next) => {
    if (e.surface === 'mobile') return next(e)
    return egmView($.ui.resolve(e) as Els, e.props, E, acts($), { path: shown, focused })
  })
}
