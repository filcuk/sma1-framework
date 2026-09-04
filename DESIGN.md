# Design philosophy

Visual and interaction principles for SMA1 Framework. Implementation details live in `USAGE.md`, tokens in `app/tokens.css`, and agent rules in `AGENTS.md`.

Aesthetics follow a GitHub-inspired palette (based on [pqm-stepper](https://github.com/filcuk/pqm-stepper)): 6px radii, system UI font, light / dark / auto theme.

## Action feedback

When a control reacts to a user action (copy succeeded, save failed, and similar):

1. **Default — in-place** on the control when it can show the outcome itself (e.g. labeled **Copy** → **Copied** / **Failed** for a short duration). Use [`flashButtonLabel()`](app/utils/button-label.js) with `.btn-label-flash` for labeled buttons; prefer this over a reaction tooltip.
2. **Fallback — timer tooltip** when in-place is not practical (icon-only controls such as the floating code-block copy button). Use success/error tones with check / × icons.
3. **When requested — banner** for page-level or persistent status messaging.

Pointer-down press feedback uses `:active` colour-mix tints: hover uses a lighter 6% mix, enabled click previews the selected look at 12%, and selected / on press uses a stronger 18% tint. Filled primaries darken via `--accent-active` / `--danger-active`.

**Also in-place:** clipboard paste-arming (prompting “Press Ctrl+V” / showing `Ctrl+V` on the button for up to ~15s) is a waiting state on the control, not only a one-shot flash.

Success and error **tooltips** (when used) use bold green / red styling (banner success/error tokens) and a small leading icon: check for success, clear (×) for error. Info tooltips stay neutral with text only.

## Tooltip modes

| Mode | Role | Lifetime |
| ---- | ---- | -------- |
| **Hover** (default) | Describe a control on pointer over or focus | Until pointer/focus leaves |
| **Timer** | Reaction feedback when in-place is not an option (e.g. icon-only copy → “Copied”) | Fixed duration; stays visible without hover |
| **Persistent** | Single anchored tip that stays until dismissed (e.g. highlight one control) | Until explicitly dismissed (e.g. user activates the highlighted control) |

### Mutual exclusion

- Hover and timer share one slot: **at most one** of them is active.
- Starting a hover tip cancels an active timer tip (and vice versa).
- Persistent tips are separate instances. They may coexist with each other and are **not** cancelled by hover/timer. Dismiss only via the intended action or dismiss API.

With the exception of persistent tooltips, never show multiple tooltips at once.

### Tooltips vs popovers vs tutorials

| Need | Use |
| ---- | --- |
| Short text on hover / focus | **Tooltip** (hover) |
| Brief reaction on an icon-only control | **Tooltip** (timer) or in-place label flash |
| One lasting tip on a control, no chrome | **Persistent tooltip** |
| Rich tip with title, longer copy, or buttons | **Popover** |
| Multi-step guided walkthrough with dimmed page and back/next | **Tutorial** (builds on popover + spotlight) |

Prefer a **tutorial** when the user must move through several steps. Prefer a **persistent tooltip** for a single highlight without navigation chrome. Prefer a **popover** when one tip needs actions but not a full tour.

## Selection highlights

Two selection highlight styles. Prefer **standard** for selectable items in controls and lists; use **light** only for low-emphasis chrome (or when matching an existing light control).

| Style | Appearance | Contiguous neighbours | Typical use |
| ----- | ---------- | --------------------- | ----------- |
| **Standard** | Accent (blue) border **and** accent-tinted background | Join under one outer border (drop shared edges; round only the run’s outer corners) | Most controls and lists — dropdown / combo menu items, combobox options, chips, similar selectable rows |
| **Light** | Lighter background only (no accent selection border) | Not joined as a selection run | Theme switch (`.theme-toggle-btn[aria-pressed="true"]`) |

**Standard** recipe (menus / list options): selected state uses something like `border-color: var(--accent)` and `background: color-mix(in srgb, var(--accent) 12%, var(--surface))`. When several selected items sit next to each other, CSS collapses the shared borders so the run reads as one outlined block.

**Light** recipe: selected / pressed state uses a softer fill only (today: `background: var(--code-bg)` on the theme toggle), without the accent selection border used by standard.

**Table row hover** is pointer feedback, not selection: body rows use an accent-tinted background and one outer accent border on hover (same border/fill language as standard, but only while the pointer is over the row). Selected rows are indicated by the checkbox column only — do not add a third *selection* look.

Do not invent a third selection look for new catalogue controls — pick **standard** or **light** and match an existing control’s CSS.

## Complex display surfaces

Large content hosts — **image preview**, **mesh preview**, **toolpath preview**, and richer editors such as **code block** and **rich text editor** — share one chrome model. APIs and attribute names live in [`USAGE.md`](USAGE.md); this section is the interaction contract.

### Control toolbar vs hover chrome

Two ways to expose related actions on a surface:

| Pattern | Role | Typical hosts |
| ------- | ---- | ------------- |
| **Built-in control toolbar** | Persistent bar of related editing / view controls (clear, copy, paste, format, maximise, highlight, and similar) | Code block, rich text editor |
| **Hover controls** | Minimal floating actions on the surface (primarily **maximise**; **home**/reset on 3D previews; optionally shared form-control chrome such as a **slider**; occasionally download or copy) | Image, mesh, and toolpath previews; code block when kept toolbar-light |

A toolbar is the fuller editing experience. When a host uses a built-in toolbar, prefer putting those actions **in the toolbar** and treating hover chrome as optional or off — hover controls are meant for a **minimalist** surface, not a second full control strip. Do not require the user to discover the same primary actions in both places.

### Hover controls and maximise

- **Maximise** is the primary hover action. It must behave the same on every host: same overlay, width, and dismiss rules via [`expandable-surface`](app/components/expandable-surface.js) (page-width stage, Escape / backdrop to close). Preview and editor maximise must not invent a parallel fullscreen layout.
- Optional **expand-on-click** (click empty surface area to maximise) may accompany the floating control; interactive chrome is excluded from that hit target.
- Hover-control **visibility**: `hover` (default), `always`, or `never`. There is no `not-hover` mode for buttons — controls that are only useful when the pointer is away are not a target pattern.
- Apps must be able to **turn each built-in hover action on or off** independently, and to **add custom hover controls** in the same floating strip without forking the maximise behaviour.

### Form controls as hover chrome

When a catalogue **form control** is useful on a display surface (layer scrubbing, opacity, scrub timeline, and similar), prefer a **chrome / density variant of that same component** over a host-specific reimplementation or a parallel “hover-only” widget.

| Do | Don’t |
| -- | ----- |
| One component, shared behaviour and `initX` API; lighter markup for the strip (e.g. `.slider--hover` omits field label / editable value / form field) | Fork range / value logic into each host (`toolpath-preview`, image, mesh, …) |
| Hosts **compose** the shared control into `.surface-actions` (left- or right-aligned as needed) | Invent a second catalogue component whose only difference is “lives on hover chrome” |
| Keep hover chrome **minimal** — readout or icon affordances, not a full form row | Drop the full form layout (stacked label + wide value field) into the floating strip |

Hover-control **visibility** (`hover` / `always` / `never`) still applies to the strip as a whole. Turning a built-in action on or off remains independent of that visibility mode.

Apply the same principle when other form controls later need a surface-chrome variant (stepper, segmented control, toggle, and so on): extend the existing component rather than special-casing per host.

### Metadata label

Image, mesh, and toolpath previews may show a muted **metadata strip** (bottom-right) for compact readouts about the loaded content.

- Ship a catalogue of **built-in fields** (dimensions / file size / SMIL frame+duration; mesh size / triangles / vertices / volume / surface area / objects; toolpath segments / layers / current layer; and similar). Some fields are the usual defaults when meta is used; others are specialised and opt-in — **every field is independently on or off**.
- Apps may append **any number of custom meta entries** (string or list, joined with a middle-dot separator) without replacing the built-ins.
- Meta **visibility**: `hover` (default), `not-hover` (visible until hover / keyboard focus on the surface), `always`, or `never`. On touch / coarse pointers without hover, `hover` and `not-hover` fall back to always-on so the strip remains reachable.
- Meta is informational chrome, not an action surface: it must not compete with hover controls for the same interaction (use `:focus-visible` / hover on the host, not sticky drag-focus, so the strip does not stick after pointer gestures).
