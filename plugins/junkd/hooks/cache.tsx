// cache: the prompt-cache check. At every main session start but a compaction (a new session, /clear, a resume),
// scripts/cache-check.sh reads the newest `core_cache_check_sessions` sessions of the session's project folder and
// prints one suggestion line or nothing; the line is drawn in a band above the prompt until it is dismissed or the
// next check replaces it. A failure goes to the debug log alone; nothing reaches the model or the screen.
import type { On } from 'claude-code'
import { C } from './cache-lib'
import type { $ } from './feature'
import { P } from './junkd-views'

// The check's line for the band; '' while there is none or it was dismissed.
let cacheLine = ''

// The script caps itself at 3 s in its own process group; the module's own timeout is the backstop above it.
const TIMEOUT_MS = 5_000

// scripts/cache-check.sh over the project folder <dir> (0 sessions: off). The last session's line never outlives it.
export async function cacheCheck($: $, dir: string): Promise<void> {
  const had = cacheLine !== ''
  cacheLine = ''
  try {
    if (had) $.ui.invalidate('ui.render')
    if (!C.sessions) return
    const r = await $.process.run([`${$.plugin.root}/scripts/cache-check.sh`, String(C.sessions), dir], { timeoutMs: TIMEOUT_MS })
    if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr.trim()}`)
    cacheLine = r.stdout.trim()
    if (cacheLine) $.ui.invalidate('ui.render')
  } catch (err) {
    cacheLine = ''
    $.ui.log(`junkd cache check: ${(err as Error)?.message ?? String(err)}`, { to: 'debug' })
  }
}

export function registerCache(on: On, _options: Record<string, unknown>): void {
  // classic.SessionStart, not session.start: it fires after /clear too and carries agent_id. The project folder is
  // the transcript's, exact where a slug of the cwd is not (a hashed long path, non-ASCII). Detached: the session
  // never waits on it.
  on('classic.SessionStart', ($, e, next) => {
    if (!e.agent_id && e.source !== 'compact') void cacheCheck($, e.transcript_path.replace(/\/[^/]*$/, ''))
    return next(e)
  })

  // The line above the prompt, under what is beneath (another plugin's band); a survey has the band alone. A
  // warning: bold, in the theme's warning colour, in a round border of it, with a dismiss button.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!cacheLine || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e).catch(() => undefined)
    const line = (
      <Box key="cache-check" flexDirection="row" gap={1} borderStyle="round" borderColor={P.warn} paddingX={1}>
        <Text color={P.warn} bold>
          ⚠️ {cacheLine}
        </Text>
        <Button key="cache-dismiss" role="dismiss" label="dismiss" onPress={() => { cacheLine = ''; $.ui.invalidate('ui.render') }}>
          ✕
        </Button>
      </Box>
    )
    return below ? (
      <Box flexDirection="column">
        {below}
        {line}
      </Box>
    ) : (
      line
    )
  })
}
