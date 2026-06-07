# Banka-Style CSS

This app uses a small, structural CSS Modules convention: each exported React component owns one sibling `.module.css` file, and that stylesheet contains one root class named `.class`.

## Component Modules

Name the component and its stylesheet together:

```text
Checkbox.tsx
Checkbox.module.css
```

Import CSS modules as `css`, then apply only the root class. The root wrapper should be a hyphenated custom element matching the component name:

```tsx
import css from "./AppHeaderBar.module.css"

export const AppHeaderBar = () => (
	<app-header-bar className={css.class}>
		<left-side>
			<strong>SignalDesk</strong>
			<AppNav />
		</left-side>
		<UserProfileButton />
	</app-header-bar>
)
```

The matching stylesheet should have a single top-level member:

```css
app-header-bar.class {
	> left-side {
	}
}
```

Only make exceptions for interactive or form wrappers where the native element is the meaningful control:

```tsx
import css from "./Checkbox.module.css"

export const Checkbox = (
	inputProps: React.InputHTMLAttributes<HTMLInputElement>,
) => (
	<label className={css.class}>
		<input {...inputProps} type="checkbox" />
		<span>Enabled</span>
	</label>
)
```

```css
label.class {
	> input {
	}
	> span {
	}
}
```

## Nest the Rendered Structure

The stylesheet should read like the component renders. Prefer tag selectors and direct-child selectors so the CSS mirrors the JSX tree:

```tsx
export const AppHeaderBar = () => (
	<app-header-bar className={css.class}>
		<left-side>
			<app-logo>
				<AppLogoSvg />
			</app-logo>
			<AppNav />
		</left-side>
		<right-side>
			<UserProfileButton />
		</right-side>
	</app-header-bar>
)
```

```css
app-header-bar.class {
	> left-side {
		> app-logo {
			> svg {
			}
		}
	}

	> right-side {
	}
}
```

## Tags Tell the Story

Use a custom tag for the root of every exported component, named after that component in kebab case. `AppHeaderBar` should render `<app-header-bar className={css.class}>`; `ProjectList` should render `<project-list className={css.class}>`.

Use official semantic HTML when it fits inside that wrapper: `nav`, `ul`, `ol`, `li`, `article`, `blockquote`, `data`, `time`, `output`, `meter`, and `progress` all carry useful meaning.

Use `header`, `main`, and `footer` only as siblings under the same parent. `header`/`main`, `main`/`footer`, and `header`/`footer` are all okay. Do not use any of those tags alone, and do not mix them with unrelated siblings; they gain meaning from their relationship under one parent.

For interactions, prefer the browser's form controls: `input`, `textarea`, `button`, `label`, `select`, `option`, `fieldset`, and `legend`.

When no built-in tag describes the local structure clearly, create a hyphenated custom element such as `left-side`, `project-summary`, or `brand-lockup`. Custom elements make the DOM and CSS easier to map back to the component.

Never use `<div>`. Use a semantic HTML element, form control, or highly local custom element instead.

Avoid single-child wrapper tags unless the wrapper distinguishes a meaningful thing, such as a form control, image, SVG, layout boundary, or independently styled repeated item.

## Type Support

`uigui/types/module.css.d.ts` constrains CSS Modules to a single exported `class` member:

```ts
declare module "*.module.css" {
	const css: { class: string }
	export default css
}
```

`uigui/types/jsx-intrinsic-elements.d.ts` allows arbitrary hyphenated custom elements in JSX:

```ts
declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			[tagname: `${string}-${string}` & {}]: React.DetailedHTMLProps<
				React.HTMLAttributes<HTMLElement>,
				HTMLElement
			>
		}
	}
}
```
