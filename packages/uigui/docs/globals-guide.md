# globals.css

uigui encourages a small global stylesheet for the parts of an interface that should be shared everywhere: an uncontroversial reset, font imports, and a compact set of design tokens. Put it in `globals.css` and import it from the main entrypoint before mounting the UI.

```ts
import "./globals.css"
```

Keep global CSS boring. Component layout, spacing, borders, shadows, and local typography usually belong in component-owned `.module.css` files. Globals are best for foundation-level choices that would be noisy or inconsistent if repeated in every component.

## What Belongs In Globals

Use `globals.css` for:

- box sizing and document sizing reset
- default `body` margin, background, text color, and font smoothing if desired
- inherited font behavior for form controls
- font imports and `@font-face` declarations
- color-scheme and color tokens
- a very small number of document-wide typography defaults, if the project benefits from them

Avoid using globals for:

- component selectors
- page-specific layout
- one-off utility classes
- large piles of extracted mockup colors
- reset rules that erase useful browser behavior without a clear reason

## Color Tokens

Prefer a small semantic palette over raw mockup variables. Raw color names such as `--mockup-color-353a47` are useful while extracting a design, but they should quickly resolve into readable tokens.

Keep the base palette greyscale. Reserve hue for `accent`, hyperlink, focus, and status roles such as `success`, `warning`, and `error`.

Use three ordered steps for ranges. `1` is the least extreme step and `3` is the most extreme step:

- `hard` means increasing contrast
- `soft` means lowering contrast
- `tint` means moving a background lighter
- `shade` means moving a background darker

Dark mode should be the default. Use `@media (prefers-color-scheme: light)` to override tokens for light mode.

```css
:root {
	color-scheme: dark;

	--fg-color: #e8e8e8;
	--fg-hard-1: #f0f0f0;
	--fg-hard-2: #f8f8f8;
	--fg-hard-3: #ffffff;
	--fg-soft-1: #c0c0c0;
	--fg-soft-2: #a0a0a0;
	--fg-soft-3: #888888;
	--fg-faint: #4a4a4a;

	--bg-color: #121212;
	--bg-tint-1: #181818;
	--bg-tint-2: #202020;
	--bg-tint-3: #222222;
	--bg-shade-1: #0d0d0d;
	--bg-shade-2: #080808;
	--bg-shade-3: #000000;
	--bg-hard-1: var(--bg-shade-1);
	--bg-hard-2: var(--bg-shade-2);
	--bg-hard-3: var(--bg-shade-3);
	--bg-soft-1: var(--bg-tint-1);
	--bg-soft-2: var(--bg-tint-2);
	--bg-soft-3: var(--bg-tint-3);

	--border-soft-1: #303030;
	--border-soft-2: #3a3a3a;
	--border-soft-3: #444444;
	--border-hard-1: #565656;
	--border-hard-2: #707070;
	--border-hard-3: #888888;

	--fill-hard-blend-mode: multiply;
	--fill-hard-opacity: 0.33;
	--fill-hard-color: var(--bg-hard-3);
	--fill-soft-blend-mode: screen;
	--fill-soft-opacity: 0.25;
	--fill-soft-color: var(--bg-soft-3);

	--color-accent: #d4a853;
	--color-link: #5db7ff;
	--color-success: #6fca8f;
	--color-warning: #f0b35a;
	--color-error: #ee7f7a;

	@media (prefers-color-scheme: light) {
		color-scheme: light;

		--fg-color: #303030;
		--fg-hard-1: #202020;
		--fg-hard-2: #101010;
		--fg-hard-3: #000000;
		--fg-soft-1: #505050;
		--fg-soft-2: #707070;
		--fg-soft-3: #888888;
		--fg-faint: #d8d8d8;

		--bg-color: #f7f7f7;
		--bg-tint-1: #fafafa;
		--bg-tint-2: #fdfdfd;
		--bg-tint-3: #ffffff;
		--bg-shade-1: #f0f0f0;
		--bg-shade-2: #eeeeee;
		--bg-shade-3: #e8e8e8;
		--bg-hard-1: var(--bg-tint-1);
		--bg-hard-2: var(--bg-tint-2);
		--bg-hard-3: var(--bg-tint-3);
		--bg-soft-1: var(--bg-shade-1);
		--bg-soft-2: var(--bg-shade-2);
		--bg-soft-3: var(--bg-shade-3);

		--border-soft-1: #d0d0d0;
		--border-soft-2: #b8b8b8;
		--border-soft-3: #a0a0a0;
		--border-hard-1: #8a8a8a;
		--border-hard-2: #707070;
		--border-hard-3: #555555;

		--fill-hard-blend-mode: soft-light;
		--fill-hard-opacity: 0.75;
		--fill-hard-color: var(--bg-hard-3);
		--fill-soft-blend-mode: multiply;
		--fill-soft-opacity: 0.75;
		--fill-soft-color: var(--bg-soft-3);

		--color-accent: #a0522d;
		--color-link: #086fd6;
		--color-success: #2f8a55;
		--color-warning: #a76500;
		--color-error: #bd312b;
	}
}
```

## Minimal Template

uigui ships a starter template at `uigui/templates/globals.css`. It is intentionally small:

- it sets predictable box sizing
- it makes the document fill the viewport
- it lets form controls inherit font settings
- it defines greyscale foreground/background ranges with dark-default color mode
- it reserves hue for accent, hyperlink, focus, and status roles
- it leaves component-specific styling to CSS Modules

Treat the template as a starting point, not a design system. Add tokens when several components genuinely need the same concept. Rename tokens when a name describes where a color came from instead of what role it plays.
