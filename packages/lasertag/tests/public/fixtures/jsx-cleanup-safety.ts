export const jsxCleanupSafetyCases = [
	...[
		`export const { AppPanel } = { AppPanel: () => <app-panel class={css.class}><aside /></app-panel> }`,
		`export const { AppPanel } = { AppPanel: Render }`,
		`export const { panel: AppPanel } = { panel: Render }`,
		`export const { panels: [AppPanel] } = { panels: [Render] }`,
		`const [AppPanel] = [Render]; export { AppPanel }`,
		`const [, AppPanel] = [null, Render]; export { AppPanel }`,
		`export const [AppPanel = Render] = []`,
	].map((declaration) => ({
		name: `destructured component retains its identity: ${declaration}`,
		source: `const css = { class: "class" }
const Render = () => <app-panel class={css.class}><aside /></app-panel>
${declaration}
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
		html: `<app-panel class="class"><aside></aside></app-panel>`,
	})),
	...[
		`<app-panel {...{ class: css.class }}><aside /></app-panel>`,
		`<app-panel {...rootProps}><aside /></app-panel>`,
		`<section {...{ class: css.class }}><app-panel class={css.class}><aside /></app-panel></section>`,
	].map((output) => ({
		name: `spread class supplies a sibling CSS root: ${output}`,
		source: `const css = { class: "class" }
const rootProps = { class: css.class }
export function AppPanel() {
	return <><app-panel class={css.class}><span /></app-panel>${output}</>
}
export const render = () => <AppPanel />`,
		html:
			`<app-panel class="class"><span></span></app-panel>` +
			(output.startsWith(`<section`)
				? `<section class="class "><app-panel class="class"><aside></aside></app-panel></section>`
				: `<app-panel class="class "><aside></aside></app-panel>`),
	})),
	...[
		`<app-panel class={css.class} children={<aside />} />`,
		`<app-panel class={css.class} children={<aside />}></app-panel>`,
		`<app-panel class={css.class} {...{ children: <aside /> }} />`,
		`<app-panel class={css.class} {...{ children: <aside /> }}></app-panel>`,
		`<app-panel class={css.class} children={<span />} {...{ children: <aside /> }} />`,
		`<app-panel class={css.class} {...{ children: <aside /> }} children={undefined} />`,
	].map((output) => ({
		name: `intrinsic children props: ${output}`,
		source: `const css = { class: "class" }
export function AppPanel() { return ${output} }
export const render = () => <AppPanel />`,
		html: output.includes(`...`)
			? `<app-panel class="class " ><aside></aside></app-panel>`
			: `<app-panel class="class"><aside></aside></app-panel>`,
	})),
	...[
		`const renderer = { map(render) { return <aside>{render()}</aside> } }`,
		`class Renderer { map(render) { return <aside>{render()}</aside> } }; const renderer = new Renderer()`,
	].map((declaration) => ({
		name: `custom map method adds DOM: ${declaration}`,
		source: `const css = { class: "class" }
${declaration}
export function AppPanel() {
	return <app-panel class={css.class}>{renderer.map(() => <span />)}</app-panel>
}
export const render = () => <AppPanel />`,
		html: `<app-panel class="class"><aside><span></span></aside></app-panel>`,
	})),
	...[
		`export default wrap(() => <app-panel class={css.class}><aside /></app-panel>)`,
		`export default () => <app-panel class={css.class}><aside /></app-panel>`,
		`export default function () { return <app-panel class={css.class}><aside /></app-panel> }`,
		`const component = wrap(() => <app-panel class={css.class}><aside /></app-panel>); export default component`,
		`const component = wrap(() => <app-panel class={css.class}><aside /></app-panel>); export { component as default }`,
	].map((declaration) => ({
		name: `direct default component keeps its identity: ${declaration}`,
		componentName: `default`,
		source: `const css = { class: "class" }
const wrap = (Render) => Render
${declaration}
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
		html: `<app-panel class="class"><aside></aside></app-panel>`,
	})),
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
