export const jsxCleanupSafetyCases = [
	...[
		`<Show when={true} fallback={null} {...{ children: <app-panel class={css.class}><aside /></app-panel> }} />`,
		`<For each={[]} {...{ fallback: <app-panel class={css.class}><aside /></app-panel> }}>{() => null}</For>`,
		`<Index each={[]} {...{ fallback: <app-panel class={css.class}><aside /></app-panel> }}>{() => null}</Index>`,
		`<Switch fallback={null} {...{ children: <Match when={true}><app-panel class={css.class}><aside /></app-panel></Match> }} />`,
	].map((output) => ({
		name: `spread output supplies a sibling CSS root: ${output}`,
		source: `import { Show, For, Index, Switch, Match } from "solid-js"
const css = { class: "class" }
export function AppPanel() {
	return <><app-panel class={css.class}><span /></app-panel>${output}</>
}
export const render = () => <AppPanel />`,
		html: `<app-panel class="class"><span></span></app-panel><app-panel class="class"><aside></aside></app-panel>`,
	})),
	{
		name: `shadowed local component supplies a sibling CSS root`,
		source: `const css = { class: "class" }
const LocalPanel = () => <span />
export function AppPanel() {
	const LocalPanel = () => <app-panel class={css.class}><aside /></app-panel>
	return <><app-panel class={css.class}><span /></app-panel><LocalPanel /></>
}
export const render = () => <AppPanel />`,
		html: `<app-panel class="class"><span></span></app-panel><app-panel class="class"><aside></aside></app-panel>`,
	},
]
