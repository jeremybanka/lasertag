import css from "./AppRoot.module.css"

export function AppRoot() {
	return (
		<app-root className={css.class}>
			<hello-world aria-label="React custom element" data-example="react" />
		</app-root>
	)
}
