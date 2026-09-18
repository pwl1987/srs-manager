# Branch Governance

- `main` is the only development branch.
- Do not create feature/fix/temp/repair/experiment branches.
- Do not force-push, rewrite history, or use destructive reset.
- `main` is protected; administrators do not bypass required checks.
- Required checks: `Backend Tests`, `Frontend Build`, `Static Analysis`.
- Candidate commits are first pushed as ephemeral `gate/<sha>` tags.
- The same SHA may update `main` only after all required checks pass.
- Use `scripts/push-main-gated.sh` after branch protection is enabled.
- Candidate gate tags are deleted after the gated push completes.
- Container/release checks remain path/tag sensitive and provide additional release evidence.
