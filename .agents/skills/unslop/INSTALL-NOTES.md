# Unslop skill in BDAI9

Original project: https://github.com/heydamir/unslop

Author: Damir Sokolovsky (@heydamir). License: CC BY 4.0 (see LICENSE). The original SKILL.md and text references/scripts are included with attribution. Optional example `.webp` image assets are not vendored; consult the upstream repository for those examples.

The skill is available for project-local Codex-compatible agents under `.agents/skills/unslop`. Invoke `$unslop` when reviewing or polishing existing web UI. Follow `DESIGN.md` and preserve backend routes, API payloads, and the existing production user flow.

**Security:** Scripts are bundled but are never executed automatically by the site or CI. Review and install their Playwright requirements if running the optional snapshot/story commands. Avoid executing vendor tools against production without inspection.
