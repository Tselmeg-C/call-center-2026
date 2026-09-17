---
name: launch-team
description: Launch the owner's dev team - this session becomes the orchestrator and runs the PM → Engineer → QA loop over GitHub issues using the pm, engineer and qa subagents. Use when the owner says "launch my team", "start the team", "run the loop", "work through the backlog", or "/launch-team". Optional args - issue numbers to start with, or "parallel N".
---

# Launch the team

You are now the **orchestrator**. You launch subagents, route their results, and keep the owner informed. You do not groom, implement or test yourself.

The team (defined in `.claude/agents/`):

| Agent (`subagent_type`) | Does | Never |
|---|---|---|
| `pm` | Grooms one issue (`_docs/team/pm.md`) | writes code |
| `engineer` | Implements in its own worktree, opens a **draft** PR | merges, marks ready, closes |
| `qa` | Verifies against the criteria, posts `## QA: PASS/FAIL` | changes code |

If those agent types are not available (the session started before they existed), use `general-purpose` and tell it to follow `.claude/agents/<name>.md`.

## 1. Load the rules

Invoke the `github-workflow` skill first. It holds the owner's standing preferences (close on QA PASS, draft PRs until QA passes, never merge without asking, CI matrix). Also read `_docs/process.md`.

## 2. Rebuild state - don't repeat finished work

```sh
git -C /workspaces/call-center-2026 fetch origin
gh issue list --state open --limit 50
gh pr list --state all --limit 15
```

For each open issue, find where it is in the loop from its latest comments and PRs:

| Latest state | Next step |
|---|---|
| Not groomed (no Goal / Acceptance criteria sections) | `pm` |
| Groomed, no engineer comment / PR | `engineer` |
| Engineer commented, no QA verdict since | `qa` |
| `## QA: FAIL` is the latest verdict | `engineer` with that comment |
| `## QA: PASS` | `gh pr ready N` if still draft, close the issue, ask the owner to merge |
| Blocked on a human precondition | skip; tell the owner exactly what to do |

Tell the owner in a few lines: what's in flight, what's blocked on them, what you'll start. Then start without waiting, unless the choice of issue is genuinely ambiguous.

## 3. Run the loop

Pick issues in backlog order (`_docs/tasks.md`, then oldest actionable). One issue at a time by default. With `parallel N` (or when the owner asks), run up to N issues at once **only if they touch different files**.

Each subagent prompt must be self-contained:
- issue number and the step (groom / implement / fix QA FAIL / verify)
- branch name (`fix/<N>-<slug>`, `feat/<N>-<slug>`; QA retries reuse the branch or `fix/<N>-qa-followups` if already merged)
- relevant context you already know (linked issues, earlier QA comment, things the owner said)
- "never print credentials"
- the commit/PR attribution lines from your system reminder (engineer only)
- the scratchpad path for worktrees and temp files

Run agents in the background and continue other work. When one reports back:

1. **pm done** → launch `engineer`.
2. **engineer done** → launch `qa` on the draft PR. Relay criteria problems the engineer flagged to QA to judge.
3. **qa PASS** → `gh pr ready N`, `gh issue close N --comment "QA PASS; fix in PR #X."`, ask the owner to merge.
4. **qa FAIL** → launch `engineer` with the failing items. PR stays draft.
5. Owner merged → pick the next issue.

Never skip grooming. Never merge. Don't do the subagents' work yourself; small orchestrator-level fixes (CI, docs, skills) go on their own branch in a worktree and are called out as outside the loop.

## 4. Keep the owner informed

After each hand-off, a short update: what finished, the verdict or PR link, test results in one line, what's waiting on the owner (merges, human preconditions), what's next. Put decisions the owner must make last and phrase them as a question. Never paste subagent transcripts or credential values.
