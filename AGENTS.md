# Working in this repository

Read the relevant code and check `git status` before editing. Preserve unrelated work and keep changes focused.

## Code

- Follow the existing TypeScript, React, Express, and MongoDB structure. Shared API types belong in `shared/`.
- Use Prettier for formatting and Biome for linting. Declare one variable per declaration, use braces, and separate logical steps with blank lines.
- Prefer direct code over extra abstractions. Add comments only when the reason is not clear from the code.
- Keep secrets, downloaded data, and generated training output out of Git.

## Verification

Run `npm run check` before handing over changes. Add or update tests for changed behaviour. Run the relevant runtime checks from [CONTRIBUTING.md](CONTRIBUTING.md#development) when changing authentication, browser interaction, models, or deployment.

Report what changed, what you verified, and anything still unresolved. Do not claim checks passed unless you ran them.

## Git

Use descriptive branches such as `feature/weight-search` or `bugfix/session-expiry`, with no tool-specific prefixes. Use conventional commits, for example `fix: preserve playback position`.

Keep commits coherent and pull requests focused. Do not rewrite shared history, force-push, merge pull requests, or delete remote branches without explicit authorisation.
