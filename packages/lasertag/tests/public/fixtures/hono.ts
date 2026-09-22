export const honoTsxSource = `
import { Fragment as Group } from "hono/jsx"
import { Suspense } from "hono/jsx/streaming"
import css from "./ProjectCard.module.css"

async function LocalReports() {
	await Promise.resolve()
	return <report-list />
}

export function ProjectCard() {
	return (
		<project-card class={css.class}>
			<Group>
				<Suspense fallback={<loading-state />}>
					<LocalReports />
				</Suspense>
			</Group>
		</project-card>
	)
}
`

export const honoCssSource = `project-card.class {
	> report-list { display: grid; }
	> loading-state { display: block; }
	> obsolete-state { display: none; }
}
`

export const cleanedHonoCssSource = `project-card.class {
	> report-list { display: grid; }
	> loading-state { display: block; }

}
`

export const honoCleanupCases = [
	{
		name: `unknown wrapped main keeps its identity`,
		source: `const css = { class: "class" }
function decorate(Render) { return Render }
export const AppPanel = decorate(() => <app-panel class={css.class}><aside /></app-panel>)
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }
export const render = () => AppPanel()`,
		html: `<app-panel class="class"><aside></aside></app-panel>`,
	},
	{
		name: `spread replaces the entire CSS root`,
		source: `import { Fragment } from "hono/jsx"
const css = { class: "class" }
export function AppPanel(props) {
	return <Fragment children={<app-panel class={css.class}><span /></app-panel>} {...props} />
}
export const render = () => AppPanel({ children: <app-panel class={css.class}><aside /></app-panel> })`,
		html: `<app-panel class="class"><aside></aside></app-panel>`,
	},
	...([`fallback`, `fallbackRender`] as const).map((prop) => ({
		name: `spread supplies ErrorBoundary ${prop}`,
		source: `import { ErrorBoundary } from "hono/jsx"
const css = { class: "class" }
function Report({ fail = true }) { if (fail) throw new Error("unavailable"); return <p /> }
export function AppPanel(props) {
	return <app-panel class={css.class}><ErrorBoundary {...props}><Report /></ErrorBoundary></app-panel>
}
export const render = () => AppPanel({ ${prop}: ${prop === `fallbackRender` ? `() => ` : ``}<aside /> })`,
		html: `<app-panel class="class"><aside></aside></app-panel>`,
	})),
	{
		name: `fallback factory adds an aside`,
		source: `import { ErrorBoundary } from "hono/jsx"
const css = { class: "class" }
function makeFallback(render) { return <aside>{render()}</aside> }
function Report({ fail = true }) { if (fail) throw new Error("unavailable"); return <p /> }
export function AppPanel() {
	return <app-panel class={css.class}><ErrorBoundary fallback={makeFallback(() => <span />)}><Report /></ErrorBoundary></app-panel>
}
export const render = () => AppPanel()`,
		html: `<app-panel class="class"><aside><span></span></aside></app-panel>`,
	},
	{
		name: `shadowed fragment renders an aside`,
		source: `import { Fragment as Group } from "hono/jsx"
const css = { class: "class" }
export function AppPanel({ Group }) {
	return <app-panel class={css.class}><Group><span /></Group></app-panel>
}
export const render = () => AppPanel({ Group: ({ children }) => <aside>{children}</aside> })`,
		html: `<app-panel class="class"><aside><span></span></aside></app-panel>`,
	},
	...([`Fragment`, `StrictMode`, `Suspense`, `ErrorBoundary`] as const).map(
		(component) => ({
			name: `${component} explicit children with comment`,
			source: `import { ${component} as Group } from "hono/jsx"
const css = { class: "class" }
export function AppPanel() {
	return <app-panel class={css.class}><Group children={<aside />}>{/* explanation */}</Group></app-panel>
}
export const render = () => AppPanel()`,
			html: `<app-panel class="class"><aside></aside></app-panel>`,
		}),
	),
] satisfies Array<{ name: string; source: string; html: string }>
