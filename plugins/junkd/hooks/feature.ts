// The shapes every feature file (core.ts, handoff.tsx, orch.tsx, tldr.tsx, ctx.ts, statusline.tsx, tools-pane.tsx,
// panel.tsx) shares with index.tsx and dispatch.ts. `$`-free, types and constants only.
//
// The engine takes `$` into a function of another file only when that function is called by its own name
// (`handoffGet($, field)`), never through an object or a table (`SETTINGS[group].get($, ...)` fails the load). So
// each feature exports plain named functions, and dispatch.ts picks one with an `if` per group.
import type { EngineInterface } from 'claude-code'
import type { JunkdHandoffRoute, JunkdToolsRoute, JunkdValue } from '../types'

export type $ = EngineInterface

// What a feature's `<feature>Set` answers: the value as stored (after coercion), or the refusal's reason.
export type SetResult = { value: JunkdValue; deny?: undefined } | { deny: string; value?: undefined }

// show opens a feature pane and never closes it: on `route` (handoff's or tools' own, each pane checks it); `focus`
// asks for the keys; `owner` marks it as that caller's. hide closes it; with `owner`, only while it is still the pane
// that owner's show opened (any other open or close since, the person's included, clears the mark). open toggles it,
// as /junkd:<feature> panel does; a `route` while the pane is up switches its tab instead. An unknown route throws
// its reason.
export type ShowInput = { route?: JunkdHandoffRoute | JunkdToolsRoute; focus?: boolean; owner?: string }
export type HideInput = { owner?: string }
export type OpenInput = { route?: JunkdHandoffRoute | JunkdToolsRoute }

// The owner mark the /junkd set puts on the feature panes it opens (panel.tsx).
export const SET_OWNER = 'junkd'
