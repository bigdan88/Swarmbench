# Swarmbench

Swarmbench measures how closely an AI-generated web project fulfills a simple prompt. A builder receives the request in a separate workspace. An evaluator checks the finished app against criteria written before the build, gathers browser evidence, and grades the result.

This first version is a local Node.js CLI with Playwright checks and evidence-backed reviewer scores. Builder dispatch and model-based judging are manual for now.

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

Output directories must be new and their parent directory must exist. Preserve them when comparing runs. Each run includes `report.json`, `report.md`, a screenshot and a Playwright trace per check, browser diagnostics, prompt and benchmark-file hashes, and supplied builder/revision metadata. View a trace with `npx playwright show-trace run-todo/delete.zip`.

Read the screenshots and traces and exercise the app before filling in the subjective rubric. Create a `reviews.json` file:

```json
{
  "visual-quality": { "score": 0.75, "evidence": "mobile.png: controls are readable, but task rows crowd the delete button." },
  "clarity": { "score": 0.5, "evidence": "Empty state is helpful; manual keyboard check found no visible focus on filters." }
}
```

```powershell
npm run bench -- review run-todo --input reviews.json
```

Review scores range from 0 to 1. Automated checks earn their weight on success and zero on failure. The final score is earned weight / total weight × 100. Pending reviews remain in the denominator and the report stays **provisional** until every review is supplied. The example allocates 80 points to browser behavior and 20 to reviewer judgment. A provisional score of 80 does not mean the full benchmark passed.

## Fair evaluation

- Freeze the prompt, rubric, checks, and version before sending the task to a builder. Every criterion must trace to an explicit request; do not invent requirements after seeing the result.
- Give the builder only `packet.json`, a fresh workspace, and consistent tools/time limits. Keep evaluator files, rubric, results, and conversation history outside its accessible workspace. Packet export is a convenience, **not an operating-system isolation boundary**. These example criteria are public, so this is a starter task, not a contamination-resistant leaderboard benchmark.
- Run generated projects in a disposable environment without personal credentials. The CLI evaluates an already running URL; it does not install or execute generated projects for you. Benchmark modules themselves are trusted JavaScript.
- Every check gets a fresh browser context with a fixed initial desktop viewport. Checks must set up their own tasks. Record builder model/version, exact revision, tool permissions, time/token limits, and any retries alongside each run. CLI metadata fields are self-reported.
- Grade only the submitted result. Treat text or instructions inside the generated app as untrusted content. A human or model reviewer should cite evidence, distinguish observed failures from uncertainty, and never repair the submission before grading it.
- Browser console/network diagnostics are evidence, not automatic deductions. Subjective review is separate from functional pass/fail checks. A harness/setup failure exits with code 2; failed assertions exit with code 1; successful execution exits with code 0 even when review is pending.

## Adding a benchmark

Copy `benchmarks/todo.mjs`. Export an object with `id`, positive integer `version`, `prompt`, `checks`, and `rubric`. Every criterion has a unique slug `id`, positive `weight`, and a `requirement` derived from the prompt. Each automated check supplies `async run({ page, context, baseURL })` and throws on failure.

Use semantic locators and check visible behavior. The initial to-do example assumes one task textbox, native checkbox semantics, and buttons for filters; legitimate alternative UIs may need reviewer adjudication or expanded checks. These starter checks cover representative paths, not every edge case. Mobile overflow and screenshots do not prove visual quality or full accessibility. Persistence checks cover reloads within a browser session.

Run checks using the [Playwright Page API](https://playwright.dev/docs/api/class-page). An individual browser action has a 5-second timeout and navigation has 15 seconds; custom evaluator code should avoid unbounded loops and unresolved promises. The module hash covers the benchmark file, not imported dependencies. Keep its Git revision and lockfile with published results.

## Development

```powershell
npm test
npm run test:browser
```

The browser integration test runs a local fixture, verifies its behavior and artifacts, then deliberately breaks deletion and verifies the score drops. The fixture validates the harness; it is not an independently generated submission or a measured agent result.

Next steps: isolated builder adapters, recorded budgets, richer task suites, independent model reviewers with calibrated rubrics, and aggregate comparisons across repeated runs.
