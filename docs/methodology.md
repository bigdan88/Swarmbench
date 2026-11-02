# Evaluation methodology

Swarmbench adapts published evaluation patterns. It does not claim benchmark equivalence or inherit the validation of another benchmark.

## Sources and implementation

| Reference read | Pattern adopted | Implementation |
| --- | --- | --- |
| [AppBench poster](https://cs329a.stanford.edu/winter2025projects/appbenchposter.pdf) and [full paper, sections 3 and appendix A](https://www.brendanmclaughlin.me/appbench/app-bench-paper.pdf) | Prompt-specific weighted checklists, dependency graphs, six task axes, L0–L4 difficulty metadata, browser observation, and network fault injection | `src/core.js`, `src/runner.js`, `src/browser-tools.js`, and the benchmark modules |
| [Vals Vibe Code Bench methodology](https://www.vals.ai/benchmarks/vibe-code) | Tests organized as user workflows with individual substeps; a workflow passes when at least 90% succeed; application scores are averaged across tasks | Workflow pass rate in each report; equal-task averages in comparisons |
| [Public vibe-code-bench runner](https://github.com/ArjunDivecha/vibe-code-bench/blob/master/vibe_eval/runner.py), [functional test runner](https://github.com/ArjunDivecha/vibe-code-bench/blob/master/vibe_eval/sandbox/test_runner.py), [scoring](https://github.com/ArjunDivecha/vibe-code-bench/blob/master/vibe_eval/scoring/aggregator.py), and [reporting](https://github.com/ArjunDivecha/vibe-code-bench/blob/master/vibe_eval/reporting/leaderboard.py) | Separate execution validation, functional tests, judging, and model/time/cost reporting | Availability gate, browser assertions, optional screenshot judge, suite runner, and comparison reports |

These are original implementations of the ideas, not copied datasets or source code. AppBench reports a small preliminary study; Vals' full harness is proprietary. The public Python project's existence does not establish broad validation. Our regression tests establish harness behavior, not agreement with human judgments.

## Task definition

Each task has an unchanged public prompt, version, optional difficulty level, executable workflows, and a review rubric. Keep these fixed before generating a submission. Every graded requirement must appear in the prompt. Record optional improvements as future task changes, rather than adding deductions after inspecting submissions.

Axes are `ui`, `functionality`, `state`, `api`, `navigation`, and `data`. They correspond to visual/interface complexity, features, state management, API integration, cross-page behavior, and data processing. Each criterion has one primary axis so its weight is counted once. Axis scores describe performance on the tested requirements; missing axes are omitted rather than reported as perfect.

Difficulty metadata supports L0–L4. The bundled starter tasks cover L0–L2. Higher levels are available for task authors; they are not claimed as tested corpus coverage.

## Workflows and dependencies

A workflow receives a fresh browser context. Steps within it share the page, cookies, local storage, and a private `state` object. Separate workflows do not share browser storage. They may still share server-side state: reset or seed the disposable backend in a workflow's `setup` before every attempt.

By default, each step depends on the previous step. `dependsOn: []` declares an independent branch. Explicit dependencies can refer to any step in the same workflow; the runner orders them topologically and rejects missing references and cycles. A failed prerequisite blocks dependent steps. Independent steps continue unless a step deadline has expired, in which case the remainder of that workflow is blocked and its context is closed. Separate workflows continue.

A passed assertion earns its criterion's weight. Failed and blocked steps earn zero and remain in the denominator. This preserves partial credit without counting inaccessible downstream functionality as successful. Setup errors are harness errors and produce no scored app report. Missing Chromium and malformed configuration are also harness errors.

The app URL must respond successfully before workflows run. An unavailable app receives zero overall points, including after review. This is an availability check, not proof that source code builds. Record build failures in the submission process; the evaluator does not install or launch arbitrary generated code.

## Two separate scores

1. **Weighted requirement score:** earned criterion weight / total criterion weight × 100. Pending reviews earn no points and keep the status provisional. This is the primary AppBench-style result.
2. **Workflow pass rate:** percentage of workflows where at least 90% of automated steps passed. Substeps count equally for this metric; failed and blocked steps count against the workflow. The threshold is stored with the task and can be configured before generation. Screenshot/manual rubric points do not change this metric.

These are different measures. A workflow can fail while still earning partial requirement credit. Comparisons show both, rather than silently mixing the formulas.

## Observation and API fixtures

Each attempted step saves a screenshot, DOM HTML, accessibility snapshot, duration, and browser diagnostics. Each workflow saves a Playwright trace. Review screenshots cover desktop and mobile from the first exercised workflow state; additional screenshots cover subsequent steps. Evidence is captured even when assertions fail where the browser remains available. Evidence capture errors are recorded separately from assertion outcomes.

`tools.mockApi` supplies deterministic browser-visible responses, while `tools.breakApi` aborts matching requests. Both return a request log and `assertUsed()` so a hardcoded screen cannot satisfy an API integration test merely by displaying the expected text. The example weather task tests success, failure, retry, and empty input. The catalog task tests response data, navigation, state, arithmetic, and reload persistence.

Browser route fixtures test frontend behavior against an explicit API contract. They do not prove that a generated backend implements the contract, or intercept requests made on the server. Test backend behavior separately for tasks that require it. Service workers are blocked so they cannot bypass browser interception.

## Reviews and calibration

Rubric criteria declare `method: 'screenshot'` or `method: 'manual'`. Screenshot judging uses a selected vision model via OpenRouter, a strict JSON schema, bounded scores, written reasons, and references to actual supplied screenshots. The builder name is withheld. A null decision means insufficient evidence and leaves the item pending. Malformed output, fabricated artifact references, or transport errors do not produce zero scores or overwrite reviews. Model decisions and token/cost metadata are saved separately for audit.

Screenshot review never replaces interaction testing. Controls that look clickable might not work. Manual criteria remain pending until an evaluator exercises them and records evidence. Already-reviewed criteria are not automatically rejudged. A manual `review` can replace a rubric score; the original model decision file is retained.

Before publishing a leaderboard, have independent reviewers score representative successful, partial, and broken submissions without seeing the automated score or builder identity. Compare their judgments with the evaluator, inspect disagreements, and revise the task/checks on a new version. Do not describe the harness as human-calibrated until that work has actually been done.

## Comparing submissions

Compare the same task definitions for every builder. The comparison command rejects different task coverage, prompt/source/version/rubric fingerprints, and duplicate run ids. It first averages repeated runs for a task and then averages task scores equally; extra repetitions of an easy task cannot raise its influence. Standard deviation is reported per task. Provisional app reviews keep comparisons provisional.

Cost and token counts are recorded when supplied, with the number of runs supplying each metric. Unknown costs remain unknown; no price table or guessed usage is applied. Build metrics are self-reported, evaluation time is measured, and judge usage comes from the provider response. Repeated evaluations of one deployed app measure evaluator variation, not variation across independent builds. For model comparisons, provide independently generated submissions and consistently recorded build budgets.

Use disposable environments. A second process in the same repository is not isolated from the rubric. Give builders only the public packet in a separate container or workspace with no access to evaluator files. Builder dispatch remains external to this CLI.
