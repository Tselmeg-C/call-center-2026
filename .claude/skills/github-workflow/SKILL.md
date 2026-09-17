---
name: github-workflow
description: This repo's GitHub issue → PR workflow and the owner's preferences. Use when picking up the next issue, running the PM/Engineer/QA loop, opening or merging PRs, closing issues, or changing CI. Triggers - "next issue", "pick up where we left off", "groom", "implement #N", "QA", "open a PR", "merge", "close the issue", CI/workflow changes.
---

# GitHub workflow

Source of truth: `_docs/process.md` and the role docs in `_docs/team/`. This skill adds the owner's standing preferences on top. Never print/log/expose credentials (AGENTS.md).

## Resuming ("pick up where we left off")

Rebuild state from GitHub, don't redo finished work:

1. `gh issue list --state open`, `gh pr list --state all --limit 10`, `git log --oneline -10`
2. For each open issue with a merged/open PR, read the last comments (`gh issue view N --comments`):
   - last comment `## QA: PASS` → close the issue
   - last comment `## QA: FAIL` → back to the Engineer with that comment
   - Engineer comment with no QA yet → run QA
3. Otherwise pick the next issue (below).

## Picking the next issue

- One issue at a time. Follow the backlog order in gh issues, then the oldest actionable open issue.
- Skip issues blocked on a human action (e.g. Railway/admin resets, credential rotation) or on another open issue. Tell the owner exactly what they need to do to unblock.
- Say which issue you picked and why, in one line, then start.

## The loop (main session = orchestrator)

The orchestrator only launches subagents; it does not groom, implement or test itself.

| Step | Subagent | Role doc | Output |
|---|---|---|---|
| 1 | PM | `_docs/team/pm.md` + `_docs/task-template.md` | Issue body rewritten (Goal / Acceptance criteria / Out of scope / Constraints); out-of-scope items linked to follow-up issues |
| 2 | Engineer | `_docs/team/software-engineer.md` | Branch, commits, tests, **draft** PR (`gh pr create --draft`), comment on issue. Does not merge, mark ready, or close |
| 3 | QA | `_docs/team/qa-engineer.md` | `## QA: PASS` / `## QA: FAIL` comment with a checkbox per criterion and tests run. Changes no code |
| 4 | Orchestrator | - | FAIL → step 2 with the QA comment (PR stays draft). PASS → `gh pr ready N`, close the issue, ask the owner to merge |

Never skip grooming. Each subagent prompt must be self-contained: issue number, which role doc to follow, what "done" is, and "never print credentials".

## Owner's preferences

- **Close issues immediately on QA PASS** - `gh issue close N --comment "QA PASS; fix in PR #X."`. No need to ask.
- **PRs stay draft until QA passes.** A draft can't be merged by accident; only the orchestrator marks it ready, and only after `## QA: PASS`. Tell engineer subagents to open drafts.
- **Never merge a PR without asking.** Always stop and ask the owner; they merge (or explicitly tell you to).
- **Report concisely**: what changed, test results, what's blocked on the owner, what's next. Offer the next issue rather than silently starting a different kind of work.
- Engineer and QA subagents leave the main checkout on `main` when they finish. When you make changes while a subagent is working in the main checkout, use a separate `git worktree` in the scratchpad so you don't switch branches under it.

## Branches, commits, PRs

- Branch from up-to-date `main`: `fix/<issue>-<slug>`, `feat/<issue>-<slug>`, `ci/<slug>`. QA follow-ups: `fix/<issue>-qa-followups`.
- Commit regularly; conventional-style messages referencing the issue, e.g. `fix(api): ... (#63)`.
- Commit messages end with the attribution line from the session's system reminder; PR bodies end with the Claude Code line.
- PR body: `## Summary` + `## Test plan` (checkboxes; say honestly what was not run).
- If GitHub's "update branch" reports false conflicts, merge `origin/main` into the branch locally and push.

## CI (`.github/workflows/ci.yml`)

| Event | Tests | Docker build | Push image | Deploy |
|---|---|---|---|---|
| Push feature branch (incl. merging `main` into it) | yes | no | no | no |
| PR opened/updated | yes | no | no | no |
| Merge → `main` | yes | yes (once per commit) | `<sha>`, `<short-sha>`, `latest` | development |
| Push `v*` tag | yes | no -- re-tags the `<sha>` image main already built (builds only if missing) | adds `v*` tag | production (`promote-production.yml`, `production` approval) |
| Docs-only change (`_docs/**`, `**/*.md`, `.claude/**`) | no | no | no | no |
| Re-run of an old `main` run | yes | no (image exists) | no `latest` move | no |

- Image tags: full SHA, short SHA, and `latest` for the dev images; add the version/release tag to the production ones.
- Build once, promote the same image: deploys always pin the full-SHA tag; short SHA, `latest` and `v*` are extra tags on the same digest.
- Rollback = explicit promotion of a previous SHA (`promote-production.yml` for production, `railway service source connect --image <sha>` for development), never re-running an old Actions run.
- Keep this matrix when editing workflows. Run `.github/workflows/test-pinned-actions.sh` (every third-party `uses:` pinned to a full SHA with a version comment) and actionlint before opening a CI PR.
- A failing check on a PR may be caused by something already on `main`. Read the failing log and the PR diff before blaming the PR.
