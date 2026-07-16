import css from "./app-root.module.css"

export function App() {
	return (
		<app-root class={css.class}>
			<hello-world aria-label="Solid custom element" data-example="solid-js" />
			<real-thing></real-thing>
		</app-root>
	)
}
