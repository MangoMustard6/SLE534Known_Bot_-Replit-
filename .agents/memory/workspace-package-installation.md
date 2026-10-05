---
name: Workspace package installation
description: Avoid root-workspace add failures when adding dependencies to one package.
---

When adding a dependency for one workspace package, use a package-scoped install such as `pnpm --filter @workspace/scripts add <package>`. The generic package-install callback may run `pnpm add` at the workspace root, where pnpm rejects adding a dependency without an explicit root flag.

**Why:** The Discord dependency was needed only by the scripts package, and the generic install failed with `ERR_PNPM_ADDING_TO_ROOT`.

**How to apply:** Use the scoped pnpm filter for dependencies that belong to a specific workspace package; keep them out of the root package unless they are truly workspace-wide tooling.
