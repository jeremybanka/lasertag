export const conservativeJsxCases = [
	...([`react`, `preact`] as const).flatMap((runtime) => [
		{
			name: `${runtime} shadowed Fragment`,
			source: `import { Fragment } from "${runtime}"
export function AppPanel({ Fragment }) {
	return <app-panel class={css.class}><Fragment><span /></Fragment></app-panel>
}`,
		},
		{
			name: `${runtime} fragment children prop with comment`,
			source: `import { Fragment } from "${runtime}"
export function AppPanel() {
	return <app-panel class={css.class}><Fragment children={<aside />}>{/* explanation */}</Fragment></app-panel>
}`,
		},
		{
			name: `${runtime} self-closing fragment children prop`,
			source: `import { Fragment } from "${runtime}"
export function AppPanel() {
	return <app-panel class={css.class}><Fragment children={<aside />} /></app-panel>
}`,
		},
	]),
	{
		name: `shadowed React namespace`,
		source: `import * as React from "react"
export function AppPanel({ React }) {
	return <app-panel class={css.class}><React.Fragment><span /></React.Fragment></app-panel>
}`,
	},
	{
		name: `Solid shadowed Show in a block`,
		source: `import { Show } from "solid-js"
export function AppPanel(props) {
	const Show = props.Component
	return <app-panel class={css.class}><Show when={true}><span /></Show></app-panel>
}`,
	},
	{
		name: `Solid shadowed Show in a map callback`,
		source: `import { Show } from "solid-js"
export function AppPanel(props) {
	return <app-panel class={css.class}>{props.items.map(({ Show }) => <Show when={true}><span /></Show>)}</app-panel>
}`,
	},
	{
		name: `shadowed local component`,
		source: `function LocalPanel() { return <span /> }
export function AppPanel({ LocalPanel }) {
	return <app-panel class={css.class}><LocalPanel /></app-panel>
}`,
	},
	{
		name: `local component factory`,
		source: `function wrap(Render) { return () => <aside><Render /></aside> }
const LocalPanel = wrap(() => <span />)
export function AppPanel() {
	return <app-panel class={css.class}><LocalPanel /></app-panel>
}`,
	},
	{
		name: `Solid fallback factory`,
		source: `import { Show } from "solid-js"
function makeFallback(render) { return <aside>{render()}</aside> }
export function AppPanel() {
	return <app-panel class={css.class}><Show when={false} fallback={makeFallback(() => <span />)}><p /></Show></app-panel>
}`,
	},
	{
		name: `Solid render-child factory`,
		source: `import { Show } from "solid-js"
function decorate(render) { return () => <aside>{render()}</aside> }
export function AppPanel() {
	return <app-panel class={css.class}><Show when={true}>{decorate(() => <span />)}</Show></app-panel>
}`,
	},
	{
		name: `Solid children prop with comment`,
		source: `import { Show } from "solid-js"
export function AppPanel() {
	return <app-panel class={css.class}><Show when={true} children={<aside />}>{/* explanation */}</Show></app-panel>
}`,
	},
	{
		name: `custom component named Fragment`,
		source: `function Fragment() { return <aside /> }
export function AppPanel() {
	return <app-panel class={css.class}><Fragment><span /></Fragment></app-panel>
}`,
	},
	{
		name: `Solid Switch explicit children`,
		source: `import { Switch, Match } from "solid-js"
export function AppPanel() {
	return <app-panel class={css.class}><Switch children={<Match when={true}><aside /></Match>}>{/* explanation */}</Switch></app-panel>
}`,
	},
	{
		name: `Solid Switch spread fallback`,
		source: `import { Switch, Match } from "solid-js"
export function AppPanel() {
	return <app-panel class={css.class}><Switch {...{ fallback: <aside /> }}><Match when={false}><span /></Match></Switch></app-panel>
}`,
	},
	{
		name: `Solid For spread fallback`,
		source: `import { For } from "solid-js"
export function AppPanel() {
	return <app-panel class={css.class}><For each={[]} {...{ fallback: <aside /> }}>{() => <span />}</For></app-panel>
}`,
	},
	{
		name: `Solid Dynamic shadowed local component`,
		source: `import { Dynamic } from "solid-js/web"
function LocalPanel() { return <span /> }
export function AppPanel({ LocalPanel }) {
	return <app-panel class={css.class}><Dynamic component={LocalPanel} /></app-panel>
}`,
	},
	{
		name: `shadowed portal function`,
		source: `import { createPortal } from "react-dom"
export function AppPanel({ createPortal }) {
	return <app-panel class={css.class}>{createPortal(<span />)}</app-panel>
}`,
	},
] satisfies Array<{ name: string; source: string }>

export const conservativeJsxCss = `app-panel.class {
	> aside { color: red; }
}
`
