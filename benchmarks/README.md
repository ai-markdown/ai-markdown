# Browser benchmarks

This directory measures the browser work of the published renderer integration: streaming duration, animation-frame gaps, long tasks, DOM growth, and movement of content relative to a reader's viewport. It uses small production apps loaded through package exports, so the result includes the selected integration's providers, styles, and rendering work.

Use it to investigate a specific performance question. The engine microbenchmark isolates preprocessing; Storybook comparisons attribute pipeline and React commit work; this harness observes the application from the browser. Those measurements complement each other, and none alone proves that scrolling, selection, or streaming presentation feels responsive.

Before quoting a result, identify the scenario's delivery schedule, document size, update count, browser, CPU throttle, and missing coverage. The historical findings below retain their dates and limitations. They are evidence from those runs, not refreshed measurements of the current release.

## Running

Build workspace packages and install the workspace dependencies before running the harness; the apps consume built package exports.

```bash
pnpm build
pnpm bench:web:selftest            # Verify sensitivity to injected work.
pnpm bench:web                    # All apps/scenarios; 5 retained repeats by default.
pnpm bench:web --app react-core
pnpm bench:web --scenario code-dense --repeats 5
pnpm bench:web --app react-core --scenario throughput-code --throttle 4
pnpm bench:web --headed
```

The local runner defaults to 2 warm-up rounds and a 400 ms pause between samples. Warm-up samples are discarded. Results are written to the gitignored `benchmarks/results/<timestamp>.json`; compare matching cells with:

```bash
node benchmarks/runner/compare.mjs <before.json> <after.json>
```

A separate [bounded performance check](sentinel/README.md) automatically compares React and Vue against the PR base or previous main commit. The exploratory matrix described below has no automatic performance budget. The GitHub [benchmark workflow](../.github/workflows/benchmark.yml) is **manual dispatch only**; automatic release-tag collection was removed on 2026-09-03. Its dispatch defaults are separate from the local runner's defaults. The workflow's self-test can fail a dispatched run because it validates the measuring instrument, not a library speed threshold.

The earlier baseline-collection attempt had four workflow runs and no successful baseline: three tag runs failed around a leaked preview server, and one manual run reached the former 120-minute cap after 40 of 84 cells. The workflow now has a 240-minute cap, but this is not evidence that automatic collection has been validated or resumed.

Several historical results explain why focused runs are preferable:

- Seven timer-paced cells deliver every 16 ms. A change that still finishes within that delivery interval may not move their stream duration. On 2026-08-30, `code-dense` measured 21.2 s unthrottled and 20.6 s at a verified 4× CPU throttle.
- Uniform 24-character delivery does not exercise the smooth-stream controller, which is not enabled in these apps. Scenario names alone are not feature coverage.
- `react-null/scale-xlong` and throttled `react-core/math-dense` hit the historical 180 s per-cell cap. Those values are censored observations, not completed timing measurements; scale fitting excludes timeouts.
- The control app itself can dominate: `react-null/scale-long` measured 171.6 s versus core's 109.5 s while repeatedly replacing a growing `<pre>` across 6,297 commits. It is not always a lower bound.

Local investigations did identify the update-count floor and helped investigate a Safari presentation report alongside separate production visual checks. Keep the question and evidence together: a result from this uniform Chromium harness cannot by itself validate Safari's smooth-stream behavior.

## Layout

| Path             | What lives there                                                        |
| ---------------- | ----------------------------------------------------------------------- |
| `kit/`           | Scenarios and the measurement harness. Framework-agnostic.              |
| `react-core/`    | The `@ai-markdown/react` README integration, instrumented.              |
| `react-mantine/` | The `@ai-markdown/react-mantine` README integration, instrumented.      |
| `react-null/`    | React text-only control; large repeated pre updates have their own cost |
| `runner/`        | Playwright driver, self-test, comparison.                               |

Three rules hold this apart, and each of them was a decision:

**Scenarios never import a renderer.** A scenario is content plus a delivery
schedule. That is what lets the same scenario run under every app and be
compared, and what will let a future framework adapter join without touching
`kit/src/scenarios.ts`. An app that knows a scenario by name has already broken
the split.

**Each framework is its own app, not a prop.** The mantine variant pulls in a
provider tree, a highlight.js adapter and three more stylesheets. Sharing one
app and branching inside it would put both dependency graphs into both
bundles, and each measurement would describe the other.

**The integration follows the package quick start.** The imports and the JSX in
each `main.tsx` follow the package README's provider and renderer setup; the
instrumentation is placed around them, never between them and React. The
moment an app memoises the content or batches the updates, it stops
describing the library and starts describing our cleverness — and the
regression it then fails to catch is exactly the one a user hits.

The apps depend on `@ai-markdown/*` as `workspace:*`, which resolves
through each package's own `exports` to its built `dist` — the same entry
point npm hands a user. It is not a source-level import and must not become
one.

## Why not Storybook

The cheap route was to point Playwright at the existing `storybook-static`;
41 stories already build, and the plan originally said to do exactly that.
Rejected: Storybook ships its own runtime, router and preview iframe into the
page, and every number collected here — LCP, long tasks, DOM node counts, rAF
gaps — would count that runtime too. A baseline that includes a harness the
user never installs cannot answer "is our renderer fast", only "is our
renderer plus Storybook fast", and the two drift apart silently as Storybook
upgrades.

## Verify harness sensitivity with the self-test

`pnpm bench:web:selftest` injects a known amount of main-thread work per chunk
and requires the metrics to respond where they can and stay flat where they
should. Run it before trusting any number out of `bench:web`, and after
touching the harness.

It has two arms because the metrics do not all answer at the same magnitude:

- **6 ms/chunk** is below the browser's 50 ms long-task threshold and inside a
  16 ms frame budget, so long tasks and frame pacing are _expected_ to stay
  flat. What must move is stream time. Asserting anything else here would fail
  an honest harness.
- **60 ms/chunk** puts every chunk over the threshold, and blocking time
  becomes arithmetic: `chunks x (handicap - 50)` is the definition of Total
  Blocking Time. Measured 2026-08-30: 4620 ms predicted, 4610 ms observed.

That 0.3% is why the tolerances are tight. The first version of the self-test
allowed blocking time to arrive at 40% of budget, and the loose floor was not
caution — it was not knowing the formula. It also failed on its first run, for
a real reason: it injected 6 ms and asserted that long tasks would appear.
They correctly did not.

## Cross-app numbers are not comparable, cross-time ones are

The two apps do not render the same DOM for the same scenario, by design.
Measured 2026-08-30 on `code-dense`: `react-core` produces 24 `<pre><code>`
blocks and zero spans, because core ships no highlighter; `react-mantine`
produces thousands of nodes because highlight.js emits a span per token. On
`mermaid-dense`, core leaves 40 code fences as text while mantine renders
diagrams into SVG.

So a node count of 74 against 4275 is not core "winning" — it is the two
packages doing different amounts of work, which is the whole reason both are
measured. Compare a cell against ITSELF over time. `compare.mjs` keys on
`app/scenario` and will never put two apps side by side; keep it that way.

## Scale — separate document size from update count

`pnpm bench:web:scale` runs one scale family and fits log(bytes) against
log(streamMs + settleMs). The output is one number, the growth exponent:
~1.0 linear, ~1.5 superlinear, ~2.0 quadratic. Its two siblings,
`bench:web:scale:cold` and `bench:web:scale:steps`, run the other two
families described below; the default alone cannot be read safely.

It deserves its own tool because every other cell in this suite is between
11 KB and 36 KB — one size wearing several names — and a renderer that is
quadratic in document length posts healthy numbers at that size. Scale is
the only axis where a defect hides entirely rather than partially.

### The same four documents, delivered three ways

A streamed document costs what its CONTENT costs plus what its UPDATE COUNT
costs, and one family cannot separate them. Three can:

| family    | updates per document | what its exponent means         |
| --------- | -------------------- | ------------------------------- |
| `cold-*`  | 1                    | rendering N bytes, once         |
| `steps-*` | exactly 100          | one update, as N grows under it |
| `scale-*` | one per 24 chars     | both at once — count follows N  |

Measured 2026-08-31, `react-core` unthrottled, four kept samples per cell.
Times are stream plus settle, because the families put the cost in different
columns and `streamMs` alone reports every cold cell as free:

| size    | `cold-` (1) | `steps-` (100) | `scale-` (N/24) |
| ------- | ----------: | -------------: | --------------: |
| 2.1 KB  |       18 ms |          73 ms |           69 ms |
| 18.4 KB |       41 ms |         106 ms |          384 ms |
| 148 KB  |      229 ms |         324 ms |        10315 ms |
| 1.15 MB |     5009 ms |        2285 ms |  did not finish |

**The headline this section used to carry — "at 1.15 MB the renderer does not
finish within three minutes" — was wrong, and wrong in an instructive way.**
That document renders in 5.0 s as one update and 2.3 s as a hundred. What
does not finish in three minutes is 50,283 updates. The reading conflated the
cost of the content with the cost of the schedule, because the only family
being measured moved both at once.

### Read the local slopes, not the fit

| interval         |  `cold-` | `steps-` |
| ---------------- | -------: | -------: |
| 2.1 → 18.4 KB    |     0.37 |     0.17 |
| 18.4 → 148 KB    |     0.82 |     0.54 |
| 148 KB → 1.15 MB | **1.48** | **0.94** |

Every cell carries the same fixed cost — mount, stylesheet, first paint — and
on the smallest cell that fixed cost is most of the reading. A constant added
to a linear curve looks sublinear in log-log, so the small cell drags the
least-squares slope down: the cold family fits **0.88** globally while its top
interval runs at **1.48**. The tool now prints both and says which to believe.

### What the three families actually establish

**With a fixed update count, this measured top interval is approximately linear.** `steps-*` runs at
0.94 across the top interval. This is consistent with useful incremental reuse, but the aggregate timing does not attribute the cost to the parser or prove O(delta) work per update.

**A single giant mount is the worse path.** `cold-*` is superlinear at the top
(1.48), and at 1.15 MB one update (5009 ms) is slower than a hundred
(2285 ms). Delivering a large document in pieces is an optimisation here, not
an overhead.

**There is a per-update floor, and it grows with the document.** Two families
at one size give two equations in two unknowns. At 148 KB a `steps` update
costs 3.24 ms for 1512 characters and a `scale` update costs 1.64 ms for 24,
so content runs about 1.1 ms/KB and the floor is about **1.6 ms per update
before a single character is processed** — 98% of the cost of a 24-character
update at that size. Solved the same way the floor is 0.41 ms at 18 KB, and
at 1.15 MB at least 3.6 ms. That is what makes `scale-*` superlinear: a floor
that grows with N, multiplied by a count that also grows with N. Treat these
as an order of magnitude — they are medians of separate runs and carry the
noise of both.

The 2.1 KB size cannot be solved, and the reason is a check on the method:
2.1 KB at 24 characters per chunk is 89 updates, so `scale-short` and
`steps-short` are very nearly the same schedule. The two equations degenerate
— and the two measurements agree, 69 ms against 73 ms, which is what the same
quantity measured down two code paths should do.

A second method agrees, and it is worth being precise about what it agrees
with. Sampling the DOM through a single `throughput-math` run gave quarter
costs of 1245, 2935, 4825 and 6420 ms. Every quarter of that stream carries
the SAME number of updates, so this is a `steps`-shaped measurement taken
inside one document: 5.2x the cost for 7x the prefix beneath it. Different
scenario, different method, same floor.

The floor is not the freeze scanner, which resumes from a checkpoint and
advances only over newly-confirmed lines. Attributing it to a layer is open
work.

Note where the existing scenarios sit: 11–36 KB. The suite reported health for
as long as it did partly because it only ever measured one size, delivered one
way.

## Resolution and measurement noise

Measured 2026-08-30, twelve consecutive runs of each cell on an idle laptop:

| cell              | run-to-run spread | what it is                    |
| ----------------- | ----------------: | ----------------------------- |
| `burst-code`      |                0% | pinned to the display refresh |
| `throughput-long` |                4% | genuine noise                 |
| `throughput-code` |      8% → 5% warm | the shortest cell; warms up   |

So **a change under ~5% is not resolvable** on the fast cells and should not
be reported as one. `compare.mjs` enforces this per metric using each run's
own spread, and prints the sample size and the widest spread beside every
cell — if that number is larger than the delta you are chasing, raise
`--repeats` instead of believing the delta.

Three settings exist to keep that band tight, and each was measured rather
than copied from folklore:

- `--warmup 2` discards the first samples. Only the shortest cell warms up,
  and only for about two runs (341, 331 against a steady ~317).
  `throughput-long` gains nothing from discarding — its 4% is real noise —
  and the frame-paced cells do not vary at all. Discarding is not free, so
  the default is the smallest number the measurement supports.
- `--repeats 5`, because a 3-sample median over a 5% spread is itself
  unstable.
- `--settle-between 400` leaves quiet time between samples, so one run's
  teardown and GC do not land inside the next.

Measurement is strictly serial — one app, one scenario, one repeat at a time.
Running cells in parallel was tried and is worse in the way that matters:
three concurrent pages gave 357/358/358 against a serial median of 323. The
spread collapses to 0% because every page is equally starved, which looks
like precision and is a systematic 11% offset.

## Reading a result

`outcome` is the first column to look at. A row that is not `settled` never
went quiet, and its settle-derived numbers are lower bounds rather than
measurements.

`frames` is the second. A p95 over a handful of frames is not a p95, and only
the sample count says so.

Null is not zero anywhere in the output. A metric the browser never reported
comes back null on purpose — "this page had no layout shift" and "this engine
does not report layout shift" are different facts, and a zero blurs them.

## Visual verification uses a different browser than the numbers

The runner drives a clean Playwright Chromium: no profile, no extensions.
Looking at a scenario through a normal browser (or an agent driving your real
profile) does **not** show the same page.

Measured while building this: a translation extension injected 55 nodes into
the render container and rewrote text between two consecutive queries, taking
the element count from 271 to 166 while the document only grew. Any count
taken there is contaminated.

### Anchor drift — the complaint nothing else here can see

`anchor-*` scenarios scroll to a rendered element part-way through delivery,
then stop touching the scroll position and watch that element's viewport
offset for the rest of the stream. Every pixel it moves is content growing or
reflowing ABOVE it — "the page jumped while I was reading", which is the most
common complaint about streaming renderers and which no timing metric can
detect.

Two numbers: `anchorDriftPx` totals the movement, `anchorMaxJumpPx` is the
largest single-frame jump. They read differently on purpose — 40px spread
across a long stream is a slow creep, 40px in one frame is a jolt, and only
the second is what a reader notices.

This is NOT the same thing as `after: 'scroll'`. That arm runs once the
stream has drained, on a document that has stopped changing, so it reports
approximately zero by construction and always did. It is kept because "does a
settled document scroll smoothly" is a fair question, but it was never the
question its own docstring claimed.

The anchor is picked from what the renderer has already produced rather than
planted by the scenario. A planted marker is a node the renderer would have
to preserve, and the shapes that drift are precisely the ones where nodes get
replaced instead of appended — a marker would have papered over the case
worth catching. If the anchor is replaced mid-stream, tracking stops rather
than reporting a number that quietly means something else.

Two things make a zero here readable rather than ambiguous.

**The self-test forces it non-zero.** Arm 5 grows a DOM block above the
renderer's container and requires the drift to be large — measured 35,096px
against 0px on a normal run. Without that, `0px` is equally consistent with
"the renderer is well behaved" and "the tracker is broken", and it took seven
independent failures to learn that the second is the likelier reading. Each
of them produced exactly `drift=0px`: arming on frame count instead of
document height (so the anchor sat at the top with nothing above it), a
diagnostic script that reimplemented the arm logic instead of calling it, a
probe that served a stale build, an anchor placed inside the control's own
filler, a scroll-anchoring opt-out that covered one wrapper instead of the
subtree, the same opt-out applied after the browser had already pinned the
scroll position, and finally a control that prepended to the MARKDOWN — which
re-parses into a different tree, so React replaced the nodes and the anchor
detached on its first sample.

**`anchorDetached` is reported.** A detached anchor stops the measurement, so
its zero is the absence of a result rather than a result. The runner prints
`⚠detached` and `compare.mjs` refuses to compare such a row.

Scroll anchoring is the other half of why a zero is not trivial. Chrome moves
`scrollY` to absorb content inserted above the viewport, so what this metric
reports is what the READER SAW move, not what the layout moved — measured on
a minimal repro, inserting 20 paragraphs above an anchor moves it 0px while
`scrollY` jumps 927 → 1607, and 680px with `overflow-anchor: none`. A jump the
browser absorbs is a jump the user never had, which makes this the more useful
of the two questions; it also means the control has to switch the feature off
or it cannot demonstrate anything.

### commits vs chunks

Each row reports `commits=N/M`: how many times the container's DOM actually
changed against how many chunks were delivered. If N were meaningfully below
M, React would be coalescing deliveries, `streamMs` would be a per-_commit_
cost wearing a per-chunk label, and — because coalescing grows with slowness
— the suite would systematically under-report exactly the large regressions
it exists to catch.

Measured 2026-08-30, and **the answer depends on pacing**, which is why this
is a reported column rather than something checked once:

| cell                        | pacing      | commits/chunks | ratio |
| --------------------------- | ----------- | -------------- | ----: |
| `throughput-code`, all apps | `immediate` | 1250/1251      |  1.00 |
| `anchor-math`, core+mantine | `frame`     | 1417/1540      |  0.92 |

Under `immediate` there is no coalescing even on `react-mantine` at ~14 ms
per chunk — several times React's work slice — so per-chunk arithmetic on the
`throughput-*` cells is sound. Under `frame` pacing roughly 8% of deliveries
land in a frame that already has one pending and get folded in, so per-chunk
numbers on those cells are off by that much.

The first of those two measurements was briefly written up here as a settled
fact about the renderer. It was a fact about one pacing, and it survived
exactly one more scenario.

### The control row

`react-null` runs the same harness over the same scenarios into a `<pre>`.
Its row is the harness floor — string slicing, dispatch, one React commit,
the browser's rendering pipeline — and `throughput-*` is only readable
against it, since a share of those durations is overhead rather than
rendering. It is a control, not a target: optimising toward it would end its
usefulness.

It also closes the worst failure this suite can have. Every timing metric
rewards doing less work, so a renderer that silently rendered nothing would
post the best numbers in the table. The runner now refuses to record a run
with zero rendered nodes, and the self-test asserts the app is above the
control on both node count and time.

`foreignNodes` in each result row is the check — it counts nodes inside the
container carrying known extension markers. Non-zero means the row is dirty.
It should be zero in every runner-produced row; if it is not, something is
injecting into the supposedly clean browser and that is worth chasing before
reading anything else.

## Pacing decides what a scenario can even see

A `timer`-paced scenario delivers on a fixed `tickMs`. It models an arrival
rate — a server dripping tokens — and answers "can the renderer keep up".
On current hardware the answer is trivially yes, and the number it produces
is mostly the schedule restated: `code-dense` is 1251 chunks x 16 ms, so it
takes ~20 s no matter what the renderer does.

Measured 2026-08-30, and it is the sharpest result of building this: the same
scenario took **21.2 s unthrottled and 20.6 s under a 4x CPU throttle**. The
throttle was verified working in the same session (a pure busy-loop went
5 ms → 20 ms → 48 ms at 1x/4x/10x, exactly linear). The scenario simply could
not see it, because the renderer had a whole frame to do very little and
still fit after being slowed fourfold.

A `frame`-paced scenario hands the next chunk over on the next animation
frame. That was the obvious fix and it was not enough: measured on the same
scenario, **10.4 s at 1x and 10.4 s at 4x**. Frame pacing swaps one clock for
another — 1250 chunks at a 120 Hz refresh is 10.4 s whatever the renderer
does, because this renderer finishes a chunk in about a millisecond and still
fits in the 8.3 ms gap after being slowed four times.

An `immediate`-paced scenario waits for nothing: the next chunk is queued on
a MessageChannel port, which yields to the event loop without the 4 ms clamp
that `setTimeout(0)` picks up. `streamMs` becomes a throughput measurement without an intentional delivery delay. It still includes event-loop, React, and harness work, and can amortize layout across several updates. Same scenario, same machine:

| pacing                |     1x |     4x | ratio | bounded by     |
| --------------------- | -----: | -----: | ----: | -------------- |
| `timer` (16 ms/chunk) | 21.2 s | 20.6 s | 0.97x | its schedule   |
| `frame` (1 chunk/rAF) | 10.4 s | 10.4 s | 1.00x | 120 Hz refresh |
| `immediate` (unpaced) | 0.33 s | 1.46 s | 4.44x | the renderer   |

Read `throughput-*` as a **JS-headroom probe** and `burst-*` as the cell
closer to what a user feels. Neither alone is enough, and the earlier version
of this section overclaimed in a way this suite's own output refutes:
frame-paced `burst-code` separates core from mantine 10.4 s to 18.7 s,
cleanly, because mantine's per-chunk cost is above one refresh interval.

The precise statement is a **dead zone**, not blindness. A regression that
keeps per-chunk cost under one refresh interval — 8.3 ms here, 16.7 ms on a
60 Hz runner — is invisible to `timer` and `frame` pacing. `immediate` has no
dead zone, and pays for it: style, layout and paint run once per rendering
opportunity, so core's `throughput-code` performed 38 of them for 1251 chunks
while mantine's performed 1074. A regression that lives in LAYOUT is
compressed by up to 33x there, and the same content reads 1:52 under
`immediate` against 1:1.8 under `frame`.

The self-test asserts this directly (arm 3): if `immediate` pacing ever
regresses into waiting for something, the 4x ratio collapses toward 1.0 and
the run fails.

## CPU throttle and comparison conditions

`--throttle 4` applies a CPU multiplier through CDP before navigation, so the
app's startup is throttled too.

The default of 1 is honest and nearly useless for comparison. The first
baseline taken on this machine came back with zero long tasks and zero
blocking time in 12 of 14 cells, and every frame p95 within a millisecond of
the display's floor — a renderer could get several times slower and most of
the table would not move. That is a fact about the hardware, not about the
renderer.

Throttling does not simulate a particular device and must not be described as
if it did; what it does is push the work far enough above the frame budget
that the metrics have somewhere to move. The multiplier is recorded in every
row, and `compare.mjs` refuses to compare runs taken at different ones — a 4x
row beside a 1x row differs by the throttle long before it differs by
anything worth reading.

## What this suite structurally cannot see

Not a to-do list — a boundary. Each of these is something a user could
notice and this design, as built, cannot report. Written down because a
benchmark's silence is otherwise indistinguishable from good news.

- **Input during the stream.** Nothing types, clicks or selects text while
  content arrives. "My selection was blown away mid-answer" and "the copy
  button didn't respond" are common complaints about streaming renderers, and
  `longestEventMs` has no events to observe. The biggest hole.
- **Real scrolling during the stream.** The `anchor-*` scenarios cover
  content moving under a stationary reader, which was the larger half. What
  is still missing is wheel/touch scrolling _while_ content arrives —
  compositor-driven scroll, scroll anchoring, and the interaction between the
  two. `scriptedScroll` uses instant `window.scrollTo` in a rAF loop, so no
  compositor scroll happens anywhere in this suite.
- **Staleness.** Nothing measures chunk-arrival to pixels. A renderer that
  batches many chunks before painting and one that paints each chunk can post
  the same `streamMs` and feel completely different.
- **The library's own streaming features.** `smoothStream`,
  `AIMarkdownDocuments` / turn-taking and `streamingCursor` are all off in
  every app. The scenario named `turn-taking` is a single growing string and
  does not exercise the coordinator at all — the name is aspirational.
- **Viewport priority.** One viewport, no on-screen/off-screen split, no
  measurement of work spent on content nobody is looking at. An optimisation
  in that direction cannot be accepted or rejected against this suite as
  built, which is worth knowing since that was part of the motivation.
- **Which layer a cost belongs to.** Everything here is measured from
  outside, so the suite can establish that a per-update floor exists and how
  it grows, and cannot say whether it is parse, hast conversion, React
  reconciliation or layout. Attribution needs instrumentation inside the
  renderer, and the scale families' job ends at proving there is something to
  attribute.
- **Worker offload.** Its benefit shows up in `longTasks` and
  `totalBlockingMs`, both ~0 in most cells at 1x — so it is only evaluable
  under throttle.
- **Paint and raster cost.** The page never scrolls during the stream and
  most of the document is below the fold.
- **Memory retention.** `heapBytes` is allocation churn (see its field doc),
  and there is no unmount/remount leak scenario.
- **Font loading.** KaTeX ships web fonts; FOUT and the shifts it causes are
  invisible because CLS is ~0 for below-fold growth.
- **Anything non-Chromium.** `performance.memory`, `longtask` and
  `layout-shift` are Chrome-only. On WebKit or Gecko the suite degrades to
  `streamMs` plus frame counts — and says so through nulls rather than
  zeroes, but it does degrade.

## Adding a scenario

Add a row to `SCENARIOS` in `kit/src/scenarios.ts`. Nothing else needs to change —
the apps expose the list, and the runner reads its work list from the app
rather than keeping a copy, so a new scenario is picked up on the next run.

Content is generated from a seed rather than pasted, so a scenario can be
scaled without hand-editing and two runs are byte-identical. Keep it big
enough to measure: `mermaid-dense` and `math-dense` were originally 1.2 s and
5.2 s of streaming, which is not long enough for steady-state cost to show
over startup noise.

## Choose and record an investigation

Start with a matching app/scenario pair from the before and after revisions. Use `cold-*` for one large mount, `steps-*` to hold update count fixed as size grows, and `scale-*` when the number of updates should grow with document size. Use timer/frame pacing to ask whether work exceeds a delivery or refresh budget, and immediate pacing for throughput headroom. Include more than one schedule when layout is a plausible bottleneck.

Keep the browser version, machine, throttle, refresh rate, viewport, warm-up, repeats, and package build mode with the artifact. The comparison script enforces matching throttle, but does not make two machines or browser builds comparable. Record timeout status, unsupported metrics, and settle behavior rather than interpreting a cap as a completed sample or null as zero cost.

For user-visible streaming claims, add evidence outside the current scenarios where needed: actual smooth-stream input with jitter, cross-chunk definitions, active selection or copy interactions, and the target browser. A scenario named after a feature does not cover it unless the app enables that feature. The current apps deliberately leave smoothing, document coordination, and the cursor off.

When adding a scenario, update the time-budget estimate as well as its content. The runner discovers scenarios from the built app, so a new row silently expands the full matrix unless that operational cost is considered. Verify sensitivity with injected work, retain the seeded input and schedule, and document the class of regressions the new cell can and cannot detect.
