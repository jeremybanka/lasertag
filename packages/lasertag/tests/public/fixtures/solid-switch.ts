export const solidSwitchCases = [
	...[
		`<Switch children={<Match when={true}><aside /></Match>} />`,
		`<Switch><Match when={true}><aside /></Match></Switch>`,
		`<Switch children={<Match when={true}><aside /></Match>}></Switch>`,
		`<Switch children={<Match when={true} children={<aside />} />} />`,
		`<Switch children={<><Match when={true}><aside /></Match></>} />`,
		`<Switch children={(<Case when={true}><aside /></Case>)} />`,
		`<Solid.Switch children={<Solid.Match when={true}><aside /></Solid.Match>} />`,
	].map((output) => ({
		name: `locally authored Match children: ${output}`,
		output,
		diagnosticCodes: [],
		reachability: `reachable` as const,
		rendersAside: true,
	})),
	{
		name: `the effective Switch body replaces its children attribute`,
		output: `<Switch {...props} fallback={null} children={<Match when={true}><aside /></Match>}><Match when={true}><span /></Match></Switch>`,
		diagnosticCodes: [`dead-selector`],
		reachability: `unreachable` as const,
		rendersAside: false,
	},
	...[
		`<Switch children={props.children} fallback={null} />`,
		`<Switch children={<Match when={true}><span /></Match>} {...props} fallback={null} />`,
	].map((output) => ({
		name: `unresolved Switch children remain uncertain: ${output}`,
		output,
		diagnosticCodes: [`selector-crosses-ownership-boundary`],
		reachability: `unknown` as const,
		rendersAside: true,
	})),
].map(({ output, ...testCase }) => ({
	...testCase,
	source: `import { Switch, Match, Match as Case } from "solid-js"
import * as Solid from "solid-js"
const css = { class: "class" }
export function AppPanel(props) {
	return <app-panel class={css.class}>${output}</app-panel>
}
export const render = () => <AppPanel children={<Match when={true}><aside /></Match>} />`,
	html: `<app-panel class="class">${testCase.rendersAside ? `<aside></aside>` : `<span></span>`}</app-panel>`,
}))
