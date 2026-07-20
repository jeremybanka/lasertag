import css from "./AppHeaderBar.module.css"

// @exhibit-region start component
export function AppHeaderBar() {
	return (
		<app-header-bar className={css.class}>
			<strong>Lasertag</strong>
			<nav aria-label="Primary">
				<a href="/docs">Docs</a>
			</nav>
		</app-header-bar>
	)
}
// @exhibit-region end component
