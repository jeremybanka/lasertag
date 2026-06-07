import styles from "./app.module.css"

export function App() {
	return (
		<div className={styles.class}>
			<hello-world aria-label="React custom element" data-example="react" />
		</div>
	)
}
