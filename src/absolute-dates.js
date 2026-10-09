// Show timestamps older than a day as absolute dates with time
// ("on Oct 3, 2026, 2:20 PM") instead of "last week".
//
// GitHub renders dates with the <relative-time> element, which switches to an
// absolute date after its `threshold` (default 30 days). Lowering the
// threshold lets the element do the formatting, in the viewer's locale.

ghqol.register("absoluteDates", () => {
  ghqol.onScan(() => {
    for (const el of document.querySelectorAll("relative-time:not([data-ghqol-date])")) {
      el.dataset.ghqolDate = "";
      const format = el.getAttribute("format");
      // Leave explicit formats alone (durations, "elapsed", micro "3d" etc).
      if (format && format !== "auto" && format !== "relative") continue;
      if (format === "relative") el.setAttribute("format", "auto");
      el.setAttribute("threshold", "P1D");
      if (!el.hasAttribute("hour")) el.setAttribute("hour", "numeric");
      if (!el.hasAttribute("minute")) el.setAttribute("minute", "2-digit");
    }
  });
});
