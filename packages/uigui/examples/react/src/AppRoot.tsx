import css from "./AppRoot.module.css"

export function App() {
	return (
		<app-root className={css.class}>
			<hello-world aria-label="React custom element" data-example="react" />
		</app-root>
	)
}
