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

Segoe UI Variable → Segoe UI → Inter → Arial for text; headings use `--font-display` (Segoe UI Variable Display). Page title 32px, section 21px, card 16px, body 14–15px, metadata 12.5px. Hero 46px with a white-to-cyan-to-gold gradient fill.

## Shape and spacing

4px base and 8px increments. Card radius 14px, controls 10px. Shadows: `--shadow-1` (rest), `--shadow-2` (lifted), `--shadow-glow` (primary hover); `--hairline` gives surfaces a 1px top highlight. Gradients: `--grad-primary` (primary buttons), `--grad-accent` (active tabs, eyebrows, KPI strips).

## Visual language

The lens motif (radial highlight inside an ellipse) appears in the product mark, hero illustration, creation cards, template art and empty states. The processing journey uses a gold-to-cyan "light path" beam. The app background carries a faint "aurora" (`--aurora`: cyan, blue and gold radial washes); the hero and sign-in panel have slowly drifting light orbs. The top bar, menus and toasts are frosted glass.

**Corporate logo.** The EssilorLuxottica wordmark (from the approved asset pack shared with Knowzy, copied unchanged to `public/brand/`) appears only as an endorsement: "by EssilorLuxottica" under the product mark, on the sign-in page and in the footer. `tests/unit/brand.test.ts` checks the inlined mark still matches the file. The palette is the application's own and has **not** been verified against the corporate brand portal.

## Studio

Studio is a dark, pro editing workspace inside the light app: `.studio` redefines the tokens (surfaces, borders, text, action blue #4C9BFF, cyan #22C3EE), so every card, field and button inside it switches over. Layout: header (product, save status, undo/redo, Export), the stage with a heads-up shape/zoom chip and a transport bar (tools, round play button, monospace timecode), a tabbed inspector (Edit, Assist, Style, Audio; selecting an item shows Edit), and a timeline with a filmstrip on the video track, the waveform on the sound track, trapezoid zoom blocks that show their ease in and out, gold chapter flags and a glowing playhead. Busy tracks get thinner lanes. Tool labels show only when the transport is wide (container query).

## Patterns

- **Status** is always text plus colour (pills with a dot), never colour alone.
- **AI content** uses the violet `ai-label`. **Simulated** integrations use the amber `mock-label`.
- **Classification** is an outlined uppercase tag with a lock icon.
- **Empty states**: icon, a title that names the situation, one sentence on what to do next, and an optional action.
- **Motion**: 150–250ms transitions, card lift on hover, page sections rise in with a short stagger. All animation is disabled under `prefers-reduced-motion`.
