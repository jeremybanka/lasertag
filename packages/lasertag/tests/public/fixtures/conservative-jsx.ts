import { jsxCleanupSafetyCases } from "./jsx-cleanup-safety.ts"
import { solidPropPrecedenceCases } from "./solid-prop-precedence.ts"

export const conservativeJsxCases = [
	...jsxCleanupSafetyCases,
	{
		name: `unresolved map receiver remains uncertain`,
		source: `export function AppPanel({ renderer }) {
	return <app-panel class={css.class}>{renderer.map(() => <span />)}</app-panel>
}`,
	},
	...solidPropPrecedenceCases.filter(({ rendersAside }) => rendersAside),
	...[
		`const React = { Fragment: () => <aside /> }`,
		`import React from "./custom-runtime"`,
		`import { runtime as React } from "./custom-runtime"`,
	].map((declaration) => ({
		name: `bound React.Fragment is not a framework fragment: ${declaration}`,
		source: `${declaration}
export function AppPanel() {
	return <app-panel class={css.class}><React.Fragment><span /></React.Fragment></app-panel>
}`,
	})),
	...[
		[`{ Fragment }`, `Fragment`],
		[`{ Fragment }`, `(Fragment as unknown)!`],
		[`{ undefined }`, `undefined`],
		[`{ undefined }`, `(undefined satisfies unknown)`],
	].map(([parameters, value]) => ({
		name: `render values with special-looking names: ${value}`,
		source: `import { Fragment as Group } from "preact"
export function AppPanel(${parameters}) {
	return <app-panel class={css.class}><Group children={${value}} /></app-panel>
}`,
	})),
	...[
		`<><app-panel class={css.class}><span /></app-panel><LocalPanel /></>`,
		`props.ready ? <><app-panel class={css.class}><span /></app-panel><LocalPanel /></> : null`,
		`<><app-panel class={css.class}><span /></app-panel>{renderPanel()}</>`,
	].map((output) => ({
		name: `unknown local output beside a known CSS root: ${output}`,
		source: `function wrap(Render) { return Render }
const LocalPanel = wrap(() => <app-panel class={css.class}><aside /></app-panel>)
function renderPanel() { return <app-panel class={css.class}><aside /></app-panel> }
export function AppPanel(props) { return ${output} }`,
	})),
	{
		name: `Solid Dynamic explicit children`,
		source: `import { Dynamic } from "solid-js/web"
export function AppPanel() {
	return <Dynamic component="app-panel" class={css.class} children={<aside />} />
}`,
	},
	{
		name: `Solid Dynamic explicit children with comment`,
		source: `import { Dynamic } from "solid-js/web"
export function AppPanel() {
	return <Dynamic component="app-panel" class={css.class} children={<aside />}>{/* explanation */}</Dynamic>
}`,
	},
	{
		name: `Solid Dynamic spread children with fixed component`,
		source: `import { Dynamic } from "solid-js/web"
export function AppPanel(props) {
	return <Dynamic {...props} component="app-panel" class={css.class} />
}`,
	},
	{
		name: `Solid Dynamic spread overrides a literal component`,
		source: `import { Dynamic } from "solid-js/web"
export function AppPanel(props) {
	return <app-panel class={css.class}><Dynamic component="span" {...props} /></app-panel>
}`,
	},
	{
		name: `Solid Dynamic spread overrides a local component`,
		source: `import { Dynamic } from "solid-js/web"
function LocalPanel() { return <span /> }
export function AppPanel(props) {
	return <app-panel class={css.class}><Dynamic component={LocalPanel} {...props} /></app-panel>
}`,
	},
	{
		name: `spread replaces children above the CSS root`,
		source: `import { Fragment } from "preact"
export function AppPanel(props) {
	return <Fragment children={<app-panel class={css.class}><span /></app-panel>} {...props} />
}`,
	},
	{
		name: `Solid loop spread can supply a different CSS root`,
		source: `import { For } from "solid-js"
export function AppPanel(props) {
	return <For each={props.items} {...props}>{() => <app-panel class={css.class}><span /></app-panel>}</For>
}`,
	},
	{
		name: `unknown wrapped main component retains its identity`,
		source: `function decorate(Render) { return Render }
export const AppPanel = decorate(() => <app-panel class={css.class}><aside /></app-panel>)
export function LoadingPanel() { return <app-panel class={css.class}><span /></app-panel> }`,
	},
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
