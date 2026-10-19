/* The orch dashboard's timeline scale, `$`-free and DOM-free: the page (orch-dashboard.html) loads it with a plain
   <script src>, tests/dashboard.sh runs it in node. Times are minutes since the epoch, positions pixels.
   - gaps: the idle stretches (no phase, planned ones included) longer than gapMin, which the chart collapses.
   - scale: the piecewise-linear map, one xOf/tOf for every renderer; each gap is gapW pixels wide.
   - viewport: the overview's rectangle (left and width in percent of the strip) for a scroll position.
   - zoomTo: a zoom change in its one order: the anchor read on the old scale, the new scale built, the scroll set on
     it, the rectangle read from it. Reading the rectangle before the new scale exists drew it over the whole strip. */
(function (root) {
  "use strict";
  // iv: [{s, e}] sorted or not, with the window's own marks ({start,start}, {now,now}, {end,end}) among them.
  function gaps(iv, start, end, gapMin) {
    var list = iv.slice().sort(function (a, b) { return a.s - b.s }), out = [], cur = list.length ? list[0].e : start;
    for (var j = 1; j < list.length; j++) {
      if (list[j].s - cur > gapMin && cur >= start && list[j].s <= end) out.push({ s: cur, e: list[j].s });
      cur = Math.max(cur, list[j].e);
    }
    return out;
  }
  // o: {start, end, zoom (minutes the view shows; 0 = all), vis (px of the view), gaps, gapW}. Each gap gets its `x`.
  function scale(o) {
    var start = o.start, end = o.end, gs = o.gaps || [], gapW = o.gapW;
    var colMin = 0;
    gs.forEach(function (gp) { colMin += gp.e - gp.s });
    var visMin = Math.max(1, end - start - colMin);
    var ppm = o.zoom ? o.vis / o.zoom : Math.max(o.vis - gs.length * gapW, 60) / visMin;
    var segs = [], px = 0, pv = start;
    gs.forEach(function (gp) {
      var w0 = (gp.s - pv) * ppm;
      segs.push({ t0: pv, t1: gp.s, x0: px, x1: px + w0 }); px += w0;
      gp.x = px; segs.push({ t0: gp.s, t1: gp.e, x0: px, x1: px + gapW }); px += gapW; pv = gp.e;
    });
    segs.push({ t0: pv, t1: end, x0: px, x1: px + (end - pv) * ppm }); px += (end - pv) * ppm;
    function xOf(t) {
      if (t <= start) return (t - start) * ppm;
      for (var k = 0; k < segs.length; k++) {
        var sg = segs[k];
        if (t <= sg.t1) return sg.t1 === sg.t0 ? sg.x0 : sg.x0 + (t - sg.t0) / (sg.t1 - sg.t0) * (sg.x1 - sg.x0);
      }
      return px + (t - end) * ppm;
    }
    function tOf(x) {
      if (x <= 0) return start + x / ppm;
      for (var k = 0; k < segs.length; k++) {
        var sg = segs[k];
        if (x <= sg.x1) return sg.x1 === sg.x0 ? sg.t0 : sg.t0 + (x - sg.x0) / (sg.x1 - sg.x0) * (sg.t1 - sg.t0);
      }
      return end + (x - px) / ppm;
    }
    return { start: start, end: end, ppm: ppm, px: px, plotW: Math.round(px), segs: segs, gaps: gs, xOf: xOf, tOf: tOf };
  }
  // The rectangle over the strip for a view `viewW` px wide scrolled `left` px in: percent of plotW.
  function viewport(sc, left, viewW) {
    if (!sc || !sc.plotW) return { left: 0, width: 0 };
    var a = Math.min(sc.plotW, Math.max(0, left)), e = Math.min(sc.plotW, Math.max(0, left) + viewW);
    return { left: a / sc.plotW * 100, width: Math.max(0, e - a) / sc.plotW * 100 };
  }
  // A scroll position the view can hold: 0 up to the strip's width less the view's.
  function clampLeft(left, sc, viewW) {
    return Math.max(0, Math.min(left, Math.max(0, sc.plotW - viewW)));
  }
  // old: the scale drawn now; build: rebuilds the chart for the new zoom and answers its scale. The anchor (the time
  // at the view's centre) is read on the old one, everything after on the new one.
  function zoomTo(old, build, left, viewW) {
    var anchor = old.tOf(left + viewW / 2);
    var sc = build();
    var l = clampLeft(sc.xOf(anchor) - viewW / 2, sc, viewW);
    return { scale: sc, left: l, vp: viewport(sc, l, viewW) };
  }
  var api = { gaps: gaps, scale: scale, viewport: viewport, clampLeft: clampLeft, zoomTo: zoomTo };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrchScale = api;
})(this);
