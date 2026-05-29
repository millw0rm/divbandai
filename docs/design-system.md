# Divband design system

This design note captures the reusable pieces extracted from `Divband (1).zip` and applied to the current dashboard shell.

## Brand direction

Divband should feel agent-first, calm, and production-ready: an off-white workspace, white surfaces, a single deep-navy accent, restrained borders/shadows, and technical snippets set apart from ordinary copy. The imported bundle also favored Persian/RTL-ready typography, so the font stack now prefers Vazirmatn when available while retaining system fallbacks.

## Core tokens

The machine-readable token source lives in [`docs/design-tokens.json`](./design-tokens.json). The most important values are:

| Token | Value | Use |
| --- | --- | --- |
| Background | `#fafaf7` | Main page background |
| Surface | `#ffffff` | Cards, forms, tables |
| Muted surface | `#f3f3ee` | Code chips, hover states, secondary panels |
| Text | `#0a0f1f` | Primary foreground |
| Muted text | `#4b5468` | Supporting copy |
| Accent | `#1e3a8a` | Primary CTAs, active navigation, links |
| Accent hover | `#2851d6` | Hover/focus accent |
| Success | `#16a34a` | Healthy/complete states |
| Warning | `#d97706` | Pending/queued states |
| Danger | `#b8203c` | Failed/blocked states |

## Applied in this repository

- `apps/frontend/src/styles.css` maps these values to dashboard CSS custom properties.
- `apps/frontend/src/dashboard.ts` adds an agent quickstart page that turns the imported product prototype's REST/MCP examples and roadmap framing into a navigable dashboard screen.
- Product language from the imported bundle is intentionally reconciled with current repository status instead of replacing existing docs wholesale, because the zip described some now-stale gaps such as the frontend not being deployable.
