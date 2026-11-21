# 지금어디가 — UI design principles

## Product and audience
A mobile-first place recommendation app for friends, groups and dates. People enter a neighborhood or station, contribute preferences in a shared room, and receive eat.pl/BC Card-supported place options. Main interaction: **agree on where to meet without endless messages**.

## Brand direction
- **Character:** friendly, grounded, decisive. Not flashy or chatbot-like.
- **Visual metaphor:** different people's choices converging on a single location.
- **Primary:** wine red `#a9283b` and hover `#8f2032`; use as one primary action, selected choice and a single meaningful accent.
- **Ink:** `#26282b`, muted `#5d6468`; canvas `#f8f7f5`, outline `#e7e3e0`; white card surfaces.
- **Typography:** Pretendard, normal-size Korean with legible 12px minimum for helper text. Strong headings 700ish, ordinary body 400–600.
- **Shapes:** understated 12–20px rounds, neutral borders, minimal shadows; no glows, gradients or emoji wallpaper.
- **Signature:** a simple connecting route of three people to one meeting pin in the entry hero; do not duplicate it on every screen.

## Six-step flow — preserve functionality
1. Where (neighborhood or subway station, disambiguation).
2. How to choose (solo/group, group size).
3. What category and food type.
4. Preferences and allergies.
5. Shared room and link.
6. Recommendation with provenance, cautious data labels, and real eat.pl details.

Never weaken risk warnings, imply allergy safety, invent store ratings/menu prices, or change K-Skill data sourcing. Preserve `id`s and state hooks such as `#location-input`, `#conditions-form`, `#share-link`, and `#result-status`.

## UI review checklist
- Each screen has one obvious next action and its label matches what actually happens.
- Selection state is visible and exposed via `aria-pressed`/`checked`; keyboard focus is visible.
- Mobile widths 320/375/390/430px: no clipped buttons or unintended horizontal scrolling.
- Touch targets should be 44px where practical, and helper labels are readable.
- Text claims match available data; avoid decorative emoji in utility labels and excessive `!!!`.
- Loading/error/empty states explain what happens next; keep active room and edit tokens intact.
- Reduced motion support and fallbacks for CDNs/JavaScript.
- Test mobile solo/group and invitation flow, and verify unchanged room API behavior. Preview URL may lack the production API mapping: use isolated E2E for flow checks.

## Source and use
This design system was produced while applying the approach of [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop) (CC BY 4.0) and [Impeccable UI design guidance](https://github.com/pbakaus/impeccable) to the real BDAI9 UI. Project-local upstream Unslop skill lives under `.agents/skills/unslop`. The production deployment is out of scope for UI-only PRs.
