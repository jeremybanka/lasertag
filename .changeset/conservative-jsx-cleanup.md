---
"lasertag": patch
---

This patch fixes cases where `lasertag fix` and editor cleanup could remove styles for elements that still render. These examples come from the new [JSX runtime tests](https://github.com/jeremybanka/lasertag/blob/540e879d54369dff3f0ff1dcc575d76b5be90aea/packages/lasertag/tests/public/fixtures/jsx-cleanup-safety.ts) and [Solid tests](https://github.com/jeremybanka/lasertag/blob/540e879d54369dff3f0ff1dcc575d76b5be90aea/packages/lasertag/tests/public/fixtures/solid-switch.ts).

Each example uses this CSS Module, imported as `css`:

```css
app-panel.class {
	> aside {
		color: red;
	}
}
```

**1. Children passed through props keep their styles.**

JSX can supply children through a prop:

```tsx
export function AppPanel() {
	return <app-panel class={css.class} children={<aside />} />
}
```

**Previously:** Lasertag could treat the self-closing element as empty and delete the `> aside` rule.

**Now:** It accounts for the `children` prop and preserves the rule. Children supplied through a spread are covered too.

**2. Spreading an element’s props no longer hides its CSS Module class.**

Extracting shared props is enough to encounter this case:

```tsx
const rootProps = { class: css.class }

export function AppPanel() {
	return (
		<>
			<app-panel class={css.class}>
				<span />
			</app-panel>
			<app-panel {...rootProps}>
				<aside />
			</app-panel>
		</>
	)
}
```

**Previously:** Lasertag could recognize only the first element as belonging to the stylesheet. Because that element contained no `<aside>`, cleanup deleted its styles.

**Now:** A class supplied through a spread remains a possible attachment to the stylesheet, so cleanup preserves the rule.

**3. A default component isn’t mistaken for its loading state.**

A file can export its main component alongside a named helper:

```tsx
// AppPanel.tsx
export default () => (
	<app-panel class={css.class}>
		<aside />
	</app-panel>
)

export function LoadingPanel() {
	return (
		<app-panel class={css.class}>
			<span />
		</app-panel>
	)
}
```

**Previously:** Lasertag could overlook the default export, analyze `LoadingPanel`, and delete CSS needed by the main component.

**Now:** It retains the default component’s identity. The fix also protects default exports passed through custom wrappers.

**4. Solid control-flow children are recognized as locally authored content.**

```tsx
import { Switch, Match } from "solid-js"

export function AppPanel() {
	return (
		<app-panel class={css.class}>
			<Switch
				children={
					<Match when={true}>
						<aside />
					</Match>
				}
			/>
		</app-panel>
	)
}
```

**Previously:** The explicit `children` prop could be overlooked, putting the live rule at risk.

**Now:** Lasertag recognizes the rendered `<aside>` and preserves its styles without a false ownership warning—just as when the `<Match>` is written inside the `<Switch>` body.

When a custom wrapper, untyped `.map()` call, or class spread leaves the rendered structure uncertain, cleanup may now retain more CSS. Supported array maps and framework wrappers still receive precise analysis.
