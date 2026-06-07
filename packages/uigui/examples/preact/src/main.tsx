import styles from "./app.module.css"

export function App() {
	return (
		<div class={styles.class}>
			<hello-world aria-label="Preact custom element" data-example="preact" />
		</div>
	)
}
