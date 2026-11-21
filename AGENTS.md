# BDAI9 coding-agent guidance

For interface changes, read [DESIGN.md](DESIGN.md), then run the project-local [`$unslop`](.agents/skills/unslop/SKILL.md) analysis. Keep the six-step journey, existing DOM IDs and API contracts. Apply `critique → polish → accessibility check`; do not make random visual changes just to increase diff size. Preserve the eat.pl/BC Card attribution and allergy warnings. Work from a feature branch and submit a draft PR; do not deploy or merge without checking tests and mobile flows.

If a skill's upstream references ask you to install dependencies or run an external script, inspect it before execution. The optional screenshot/story scripts require a local test environment, not the production AWS server.
