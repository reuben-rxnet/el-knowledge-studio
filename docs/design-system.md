# Design system

Tokens live in `src/app/globals.css` (`:root`) and are exposed to Tailwind via `@theme`. Components use tokens, never literal colours.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--brand-navy` | #071A33 | Navigation, hero |
| `--deep-blue` | #0B2D5B | Step numbers, video track |
| `--action` | #1565C0 | Primary actions, focus ring |
| `--cyan` | #00A6CE | Lens highlights, progress beam |
| `--teal` | #00A99D | Secondary data |
| `--gold` | #D6A84B | Tagline, focus-zoom marks |
| `--bg` / `--surface` / `--surface-alt` | #F5F7FA / #FFFFFF / #EDF2F7 | Grounds |
| `--text` / `--text-2` / `--muted` | #17212B / #536170 / **#5A6575** | Text |
| `--success` / `--warning` / `--error` / `--info` | **#11704D / #8A5A10 / #B32828 / #1F5FB8** | Status |
| `--ai` | #5B4BB7 | AI labels |

**Deviation from the brief:** the requested muted text (#718096) and status colours (#16865C, #B7791F, #C53030, #246BCE) fall just below WCAG 2.2 AA 4.5:1 when used as small text on their tinted backgrounds, so axe failed them. The shipped values are the closest darker shades that pass. Change them only after re-running `npm run test:e2e`.

A dark palette is defined for `prefers-color-scheme: dark`.

## Type

Segoe UI Variable → Segoe UI → Inter → Arial. Page title 30px, section 20px, card 16px, body 14–15px, metadata 12.5px. Hero 46px.

## Shape and spacing

4px base and 8px increments. Card radius 12px, controls 8px. Two shadows (`--shadow-1` rest, `--shadow-2` lifted).

## Visual language

The lens motif (radial highlight inside an ellipse) appears in the product mark, hero illustration, creation cards, template art and empty states. The processing journey uses a gold-to-cyan "light path" beam. Glass effects are limited to the hero.

## Patterns

- **Status** is always text plus colour (pills with a dot), never colour alone.
- **AI content** uses the violet `ai-label`. **Simulated** integrations use the amber `mock-label`.
- **Classification** is an outlined uppercase tag with a lock icon.
- **Empty states**: icon, a title that names the situation, one sentence on what to do next, and an optional action.
- **Motion**: 150–250ms transitions, card lift on hover. All animation is disabled under `prefers-reduced-motion`.
