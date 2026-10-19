#!/usr/bin/env bash
# The orch dashboard page's timeline scale (plugins/junkd/skills/orch/dashboard/scale.js) under node: the zoom order
# (the overview rectangle read from the new scale), xOf monotonic, tOf(xOf(t)) = t, the idle-gap collapse; then the
# page's own shape: scale.js and status.js by plain <script src>, no module script, no fetch, no http(s) resource, the
# demo data parsing with every section filled.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd -P)
dash="$root/plugins/junkd/skills/orch/dashboard"
command -v node >/dev/null || { echo "dashboard.sh: node is needed"; exit 1; }

node - "$dash/scale.js" <<'JS'
const S = require(process.argv[2])
let failed = 0
const ok = (cond, what) => { if (!cond) { failed++; console.log('FAIL', what) } }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// A 24 h window (minutes), busy throughout: no gap. The view is 1000 px wide.
const H = 60, start = 1_000_000, end = start + 24 * H, vis = 1000, viewW = 1000, GAPW = 28
const busy = [{ s: start, e: start }, { s: start, e: end }, { s: end, e: end }]
const noGaps = S.gaps(busy, start, end, 45)
ok(noGaps.length === 0, 'a busy window has no gap')
const build = zoom => S.scale({ start, end, zoom, vis, gaps: S.gaps(busy, start, end, 45), gapW: GAPW })

// The zoom bug: from "all" (the whole window in the view) to 12h, the rectangle covers half the strip, not all of it.
const all = build(0)
ok(near(all.plotW, vis, 1), `all: the strip is the view (${all.plotW})`)
ok(near(S.viewport(all, 0, viewW).width, 100), 'all: the rectangle covers the strip')
const z = S.zoomTo(all, () => build(720), 0, viewW)
ok(z.scale.plotW === 2000, `12h on 24h: the strip is twice the view (${z.scale.plotW})`)
ok(z.vp.width < 100, `12h: the rectangle is narrower than the strip (${z.vp.width})`)
ok(near(z.vp.width, 50, 0.01), `12h: the rectangle is half the strip (${z.vp.width})`)
// the anchor: the time at the view's centre before the zoom stays at its centre after it
const c = all.tOf(viewW / 2)
ok(near(z.scale.tOf(z.left + viewW / 2), c, 1e-6), 'the centre time is kept across the zoom')
ok(near(z.vp.left, 25, 0.01), `12h: the rectangle sits around the old centre (${z.vp.left})`)
// back to all: the whole strip again; 1h: a 24th of it
ok(near(S.zoomTo(z.scale, () => build(0), z.left, viewW).vp.width, 100), '12h then all: the whole strip')
ok(near(S.zoomTo(all, () => build(60), 0, viewW).vp.width, 100 / 24, 0.01), '1h: a 24th of the strip')
// the scroll stays inside the strip at both ends
ok(S.zoomTo(build(720), () => build(720), 1e9, viewW).left === 1000, 'a scroll past the end is the last view')
ok(S.zoomTo(build(720), () => build(720), -500, viewW).left === 0, 'a scroll before the start is 0')
ok(S.viewport({ plotW: 0 }, 0, viewW).width === 0 && S.viewport(undefined, 0, viewW).width === 0, 'no strip: an empty rectangle')

// Two busy islands 5 h apart: one gap, GAPW px wide, between them.
const iv = [{ s: start, e: start }, { s: end, e: end }, { s: start, e: start + 2 * H }, { s: start + 7 * H, e: end }]
const gs = S.gaps(iv, start, end, 45)
ok(gs.length === 1 && gs[0].s === start + 2 * H && gs[0].e === start + 7 * H, `one gap, 2h to 7h (${JSON.stringify(gs)})`)
ok(S.gaps(iv, start, end, 5 * H).length === 0, 'a gap of exactly gapMin is no gap')
ok(S.gaps(iv, start, end, 5 * H - 1).length === 1, 'a gap a minute over gapMin is one')
const sc = S.scale({ start, end, zoom: 0, vis, gaps: gs, gapW: GAPW })
ok(near(sc.xOf(gs[0].e) - sc.xOf(gs[0].s), GAPW), 'the gap is GAPW px wide')
ok(near(sc.gaps[0].x, sc.xOf(gs[0].s)), "the gap's x is where it starts")
ok(near(sc.plotW, vis, 1), `all with a gap: the strip is still the view (${sc.plotW})`)
ok(near(sc.xOf(start + 2 * H) / (sc.plotW - GAPW), 2 / 19, 1e-3), 'the busy time shares what the gap leaves')

// xOf is monotonic and tOf inverts it, gaps, zoom and the edges included.
for (const s2 of [sc, build(720), build(60)]) {
  let last = -Infinity, mono = true, inv = true
  for (let t = start - 30; t <= end + 30; t += 7) {
    const x = s2.xOf(t)
    if (!(x >= last)) mono = false
    last = x
    if (!near(s2.tOf(x), t, 1e-6)) inv = false
  }
  ok(mono, 'xOf is monotonic')
  ok(inv, 'tOf(xOf(t)) = t')
}
if (failed) { console.log(`${failed} scale check(s) failed`); process.exit(1) }
console.log('scale: all checks passed')
JS

page="$dash/orch-dashboard.html"
grep -qF '<script src="status.js"></script>' "$page" && grep -qF '<script src="scale.js"></script>' "$page" ||
    { echo "dashboard.sh: the page does not load status.js and scale.js by <script src>"; exit 1; }
if grep -Eq 'https?://' "$page"; then echo "dashboard.sh: the page names an http(s) resource"; exit 1; fi
if grep -Eq 'type="module"|fetch\(|XMLHttpRequest|import\(' "$page"; then echo "dashboard.sh: the page uses a module, fetch or XHR"; exit 1; fi
grep -qF 'status.js unreachable' "$page" || { echo "dashboard.sh: the page lost the unreachable note"; exit 1; }
if grep -qF 'mockPast' "$page"; then echo "dashboard.sh: the mock data is back in the page"; exit 1; fi
grep -qF 's.src="status.js?t="+Date.now();' "$page" && grep -qF 'setInterval(poll,5000);' "$page" ||
    { echo "dashboard.sh: the page does not re-read status.js every 5 s"; exit 1; }
node -e '
  global.window = {}; require(process.argv[1]); const O = window.ORCH
  const need = ["tasks", "agents", "events", "lessons"].filter(k => !(Array.isArray(O[k]) && O[k].length))
  if (need.length || !O.window || !O.usage || !O.watchdog) { console.log("status.sample.js lacks " + need.join(" ")); process.exit(1) }
' "$dash/status.sample.js"
echo "dashboard tests passed"
