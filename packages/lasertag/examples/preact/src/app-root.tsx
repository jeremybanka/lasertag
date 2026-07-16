import css from "./app-root.module.css"

export function AppRoot() {
	return (
		<app-root className={css.class}>
			<hello-world aria-label="Preact custom element" data-example="preact" />
			<hello-world aria-label="Preact custom element" data-example="preact" />
			<hello-world aria-label="Preact custom element" data-example="preact" />
			<unaccounted-for />
		</app-root>
	)
}
