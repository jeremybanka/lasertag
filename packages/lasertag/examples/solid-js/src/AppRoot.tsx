import css from "./app-root.module.css"

export function AppRoot() {
	return (
		<app-root class={css.class}>
			<hello-world aria-label="Solid custom element" data-example="solid-js" />
		</app-root>
	)
}
