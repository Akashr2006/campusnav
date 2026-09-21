# Git Push Execution Rule

## Rule: Manual/Explicit Git Push Only

- **DO NOT** automatically run `git push` or `git push origin <branch>` upon completing tasks, edits, or verification.
- **ONLY** execute `git push` when the user explicitly requests a push in the AI prompt box (e.g., "push to git", "git push", "push code") or when the user executes it manually in their terminal.
- Staging (`git add`) and local commits (`git commit`) can be done as required or requested, but pushing to the remote repository requires explicit user instruction.
