# BDAI9 coding-agent guidance

1. Read [README.md](README.md) and the [documentation index](docs/README.md) first.
2. Keep the six-step flow, DOM IDs, API contracts and existing room data compatibility unless a task explicitly changes them.
3. For UI, read [DESIGN.md](DESIGN.md) and [Unslop skill](.agents/skills/unslop/SKILL.md). Review accessibility, mobile widths and existing behavior.
4. For ranking or allergy logic, consult [docs/recommendation.md](docs/recommendation.md) and add regression tests. Unknown allergy risks must not be represented as safe.
5. For API/deployment, consult [docs/architecture.md](docs/architecture.md) and [docs/deployment.md](docs/deployment.md). Protect the production SQLite database and server credentials.
6. Use a focused feature branch with PR base `main`. CI/Vercel success does not imply the AWS backend was deployed.
7. Never commit secrets, room host/edit tokens, live user data or `.env`. Inspect third-party scripts before execution.

Keep the root README focused on the product. Link to one canonical doc per topic rather than duplicating long sections.
