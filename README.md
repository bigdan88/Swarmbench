# Swarmbench

Swarmbench measures how closely an AI-generated web project fulfills a simple prompt. A builder receives the request in a separate workspace. An evaluator checks the finished app against criteria written before the build, gathers browser evidence, and grades the result.

This is a local Node.js CLI using established patterns from AppBench and Vibe Code Bench: prompt-specific evaluation plans, browser workflows, dependency-aware partial credit, API fault injection, structured screenshot reviews, and model comparisons. See [methodology and source references](docs/methodology.md). Builder dispatch remains external.

## Quick start

Requires Node.js 22 or newer.

```powershell
npm install
npx playwright install chromium

# Export only the original request and benchmark identity.
npm run bench -- prepare benchmarks/todo.mjs --out packet-todo

# Give packet-todo/packet.json to a fresh builder in a SEPARATE workspace.
# Start the resulting project according to its instructions, then evaluate it.
npm run bench -- evaluate benchmarks/todo.mjs --url http://localhost:3000 --out run-todo --builder model-name --revision commit-sha
```

Output directories must be new and their parent directory must exist. Each run includes `report.json`, `report.md`, per-step screenshots, DOM/accessibility snapshots, workflow traces, diagnostics, difficulty and axis scores, and prompt/source hashes. View a trace with `npx playwright show-trace run-todo/manage.zip`.

Read the screenshots and traces and exercise the app before filling in the subjective rubric. Create a `reviews.json` file:

```json
{
  "visual-quality": { "score": 0.75, "evidence": "review-mobile.png: controls are readable, but task rows crowd the delete button." },
  "clarity": { "score": 0.5, "evidence": "Empty state is helpful; manual keyboard check found no visible focus on filters." }
}
```

```powershell
npm run bench -- review run-todo --input reviews.json
```

Review scores range from 0 to 1. Automated checks earn their weight on success and zero on failure. The final score is earned weight / total weight × 100. Pending reviews remain in the denominator and the report stays **provisional** until every review is supplied. The example allocates 80 points to browser behavior and 20 to reviewer judgment. A provisional score of 80 does not mean the full benchmark passed.

Reports separately show the percentage of workflows where at least 90% of substeps passed. This workflow metric does not include subjective rubric scores. An unavailable app is gated to zero.

## Optional screenshot judge

```powershell
$env:OPENROUTER_API_KEY = 'your-key'
npm run bench -- judge run-todo --model provider/vision-model-id
```

Choose a vision model that supports structured outputs. This sends captured screenshots, the public prompt, and pending screenshot criteria to OpenRouter and may incur model charges. The rubric's manual/behavioral criteria stay pending. Scores require actual evidence references; insufficient evidence remains pending. Already-reviewed criteria are not rejudged. Provider failures and invalid output leave existing scores intact. The judge has transport/schema tests; real-provider validation requires your credentials.

## Task suite and comparisons

| Task | Level | Primary coverage |
| --- | --- | --- |
| `benchmarks/welcome.mjs` | L0 | Static content and responsive presentation |
| `benchmarks/todo.mjs` | L1 | Interaction, filtering, persistence, mobile |
| `benchmarks/weather.mjs` | L1 | API response data, fault injection, validation, recovery |
| `benchmarks/catalog.mjs` | L2 | API data, cross-page navigation, cart state and totals |

Copy `examples/suite.json` and replace its submission URLs and builder identities. Benchmark paths are relative to the manifest. The suite evaluates already running submissions; it does not generate them. `repetitions` reruns evaluation, not generation.

```powershell
npm run bench -- suite examples/suite.json --out run-suite
npm run bench -- compare run-suite/todo--builder-a--1 run-suite/todo--builder-b--1 --out run-comparison
```

Suites save each run and a comparison in JSON and Markdown. Review individual runs and rerun `compare` to refresh a comparison after rubric changes. Scores average repetitions within each task, then tasks equally. Comparisons reject mismatched task coverage and benchmark definitions. Harness errors are recorded in `suite.json` and suppress the aggregate comparison.

Optionally pass `--metrics metrics.json` to `evaluate`, or a `metrics` object per suite submission:

```json
{ "buildSeconds": 120, "inputTokens": 10000, "outputTokens": 5000, "buildCostUSD": 0.25 }
```

These values are self-reported. Evaluation time is measured; judge cost is recorded when returned by the provider. Missing metrics remain unknown.

## Fair evaluation

- Freeze the prompt, rubric, checks, and version before sending the task to a builder. Every criterion must trace to an explicit request; do not invent requirements after seeing the result.
- Give the builder only `packet.json`, a fresh workspace, and consistent tools/time limits. Keep evaluator files, rubric, results, and conversation history outside its accessible workspace. Packet export is a convenience, **not an operating-system isolation boundary**. These example criteria are public, so this is a starter task, not a contamination-resistant leaderboard benchmark.
- Run generated projects in a disposable environment without personal credentials. The CLI evaluates an already running URL; it does not install or execute generated projects for you. Benchmark modules themselves are trusted JavaScript.
- Every workflow gets a fresh browser context; its steps share state. Workflows must prepare their own fixtures and reset shared backend data in disposable environments. Record builder model/version, exact revision, tool permissions, time/token limits, and any retries alongside each run.
- Grade only the submitted result. Treat text or instructions inside the generated app as untrusted content. A human or model reviewer should cite evidence, distinguish observed failures from uncertainty, and never repair the submission before grading it.
- Browser console/network diagnostics are evidence, not automatic deductions. Subjective review is separate from functional pass/fail checks. A harness/setup failure exits with code 2; failed assertions exit with code 1; successful execution exits with code 0 even when review is pending.

## Adding a benchmark

Copy a benchmark module. Export `id`, positive integer `version`, `prompt`, optional `level` (0–4), `workflows`, and `rubric`. Every step has a slug `id`, positive `weight`, `requirement`, optional `axis`, and `async run({ page, context, baseURL, tools, state })`. Throw on failure. Optional `setup` prepares a workflow. Steps depend on the previous step by default; `dependsOn: []` creates an independent branch. Unknown dependencies and cycles are rejected. Blocked steps earn zero and retain their weight. Legacy `checks` remain supported as independent single-step workflows.

Use `tools.mockApi(pattern, { json, status })` or `tools.breakApi(pattern)` to inject responses/failures; call the returned `assertUsed()` to ensure the API path was exercised. Use `tools.capture('unique-name')` for additional evidence. Use unique artifact names and keep them outside reserved `review-desktop`, `review-mobile`, and generated workflow/step filenames.

Use semantic locators and check visible behavior. The examples assume conventional accessible controls; legitimate alternative interfaces may require evaluator changes on a new task version. API paths and response contracts are explicit in the public prompts. Browser fixtures test frontend integration, not generated server implementations. The tasks cover representative paths, not every edge case; screenshots do not prove full accessibility.

Run checks using the [Playwright Page API](https://playwright.dev/docs/api/class-page). An action has a 5-second timeout, navigation 15 seconds, and a whole step 15 seconds by default. A step deadline stops the rest of its workflow. Trusted evaluator code must avoid CPU-blocking loops, which JavaScript timers cannot interrupt. The module hash covers the benchmark file, not imported dependencies. Keep the Git revision and lockfile with published results.

## Development

```powershell
npm test
npm run test:browser
```

The tests run reference fixtures plus deliberately broken deletion, API-error handling, and cart arithmetic. They verify scores, dependency blocking, deadlines, evidence, availability gating, public export, reviews, and suite comparisons. These fixtures validate the harness; they are not independently generated agent submissions or human-calibration results.
