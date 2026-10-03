# Bounded renderer performance check

`pnpm bench:sentinel --baseline /path/to/built/repository` compares the current
React and Vue libraries with another revision on the same machine and Chromium
instance. Build engine/core/adapters in both repositories first. The baseline
must have its own installed dependencies. `pnpm test:perf-control` tests the
comparison policy without a browser.

The automatic `Renderer performance` workflow runs for relevant PRs and main
pushes. It builds the PR base (or previous main commit) and candidate separately,
then applies the **candidate's identical harness** to both built libraries. It
uses neither a downloaded timing baseline nor a copy of old benchmark code.
A failure exits nonzero. The job has a 20-minute ceiling; browser measurement
has a 12-minute deadline and individual samples a 30-second limit. No full soak
or exploratory benchmark matrix is run.

Four fixed workloads run on each adapter: medium and long prose, fenced code,
and references whose definitions live in a separate document chunk. Each has
64 committed updates; prose size changes without changing update count. Every
sample validates the final paragraphs/code/links. Both revisions must produce
the same text and receive the same bytes and updates. This prevents missing
output from looking like a speed improvement.

The measurement includes each update's render, contribution effects and layout.
React explicitly commits each update with `flushSync`; Vue commits with
`nextTick`. A MessageChannel task lets pending effects finish. This deliberately
measures a fixed amount of committed work, **not** natural framework batching,
network-paced streaming, smooth reveal, frame rate or user input latency. Compare
an adapter against itself, not React timing against Vue timing. The broad
benchmark remains useful for those other questions.

Each cell discards one warm-up per revision and records six observations per
revision in alternating AB/BA order, each on a fresh page. A timing regression
must exceed 30% and 30 ms, as well as twice the larger observed sample range.
If the slowdown exceeds the allowance but noise prevents a conclusion, the job also fails as inconclusive and asks for a rerun. This is a coarse regression gate, not a claim that smaller differences are safe.
Forced-GC retained JavaScript heap is recorded after the final render, outside
the timing interval; its gate uses 50%, 1 MiB and the same noise rule. It is not
peak memory or a leak test; existing document-lifetime tests cover teardown.

Before comparing revisions, both adapters must detect 5 ms of injected CPU work
per update using the same workload observer and comparison policy, without
changing output. Instrument failure fails the job too.

`benchmarks/results/sentinel-*.json` retains samples, comparison thresholds,
content hashes, compiled bundle hashes, source revisions, dependency input
paths, Node/Chromium/machine details, sensitivity results and failures. CI uploads
it for 30 days. A deliberate semantic or performance change should update its
contract with review, rather than silently broadening a threshold.
