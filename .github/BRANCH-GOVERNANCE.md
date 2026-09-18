# Branch Governance

- `main` is the only development branch.
- Do not create feature/fix/temp/repair/experiment branches.
- Do not force-push, rewrite history, or use destructive reset.
- `main` is protected; administrators do not bypass required checks.
- Required checks: `Backend Tests`, `Frontend Build`, `Static Analysis`, `Container Build`, `Delta Coverage`, `Contract Tests`.
- `Delta Coverage` requires changed executable line coverage >= 85% and rejects overall line coverage regressions greater than 0.5 percentage points.
- API implementation changes under `backend/routes/**` or `backend/server.js` require a changed real integration test under `backend/tests/integration/*.integration.test.js`.
- Candidate commits are first pushed as ephemeral `gate/<sha>` tags.
- The same SHA may update `main` only after all required checks pass.
- Use `scripts/push-main-gated.sh` after branch protection is enabled.
- Candidate gate tags are deleted after the gated push completes.
- Container/release checks remain path/tag sensitive and provide additional release evidence.
