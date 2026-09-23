export const solidPropPrecedenceCases = [
	{
		name: `Solid undefined JSX children retain spread children`,
		output: `<Show {...props} when={true} fallback={null}>{undefined}</Show>`,
		rendersAside: true,
	},
	{
		name: `Solid undefined explicit children retain spread children`,
		output: `<Show {...props} when={true} fallback={null} children={undefined} />`,
		rendersAside: true,
	},
	{
		name: `Solid undefined fallback retains spread fallback`,
		output: `<Show {...props} when={false} fallback={undefined}><span /></Show>`,
		rendersAside: true,
	},
	{
		name: `Solid conditional undefined children retain spread children`,
		output: `<Show {...props} when={true} fallback={null}>{props.ready ? undefined : null}</Show>`,
		rendersAside: true,
	},
	{
		name: `Solid void children retain spread children`,
		output: `<Show {...props} when={true} fallback={null}>{void 0}</Show>`,
		rendersAside: true,
	},
	{
		name: `Solid Dynamic undefined children retain spread children`,
		output: `<Dynamic {...props} component="app-panel" class={css.class}>{undefined}</Dynamic>`,
		rendersAside: true,
	},
	{
		name: `Solid loop undefined fallback retains spread fallback`,
		output: `<For {...props} each={[]} fallback={undefined}>{() => <span />}</For>`,
		rendersAside: true,
	},
	{
		name: `Solid nested component returning undefined retains spread children`,
		output: `<Show {...props} when={true} fallback={null}><Show when={true}>{undefined}</Show></Show>`,
		rendersAside: true,
	},
	{
		name: `Solid fragment returning undefined retains spread children`,
		output: `<Show {...props} when={true} fallback={null}><>{undefined}</></Show>`,
		rendersAside: true,
	},
	{
		name: `Solid comment-only body leaves spread children live`,
		output: `<Show {...props} when={true} fallback={null} children={<span />}>{/* explanation */}</Show>`,
		rendersAside: true,
	},
	{
		name: `Solid null JSX children override spread children`,
		output: `<Show {...props} when={true} fallback={null}>{null}</Show>`,
		rendersAside: false,
	},
	{
		name: `Solid null explicit children override spread children`,
		output: `<Show {...props} when={true} fallback={null} children={null} />`,
		rendersAside: false,
	},
	{
		name: `Solid null fallback overrides spread fallback`,
		output: `<Show {...props} when={false} fallback={null}><span /></Show>`,
		rendersAside: false,
	},
	{
		name: `Solid multiple JSX children override spread children`,
		output: `<Show {...props} when={true} fallback={null}>{undefined}{null}</Show>`,
		rendersAside: false,
	},
].map(({ output, ...testCase }) => ({
	...testCase,
	source: `import { Show, For } from "solid-js"
import { Dynamic } from "solid-js/web"
const css = { class: "class" }
export function AppPanel(props) {
	return ${output.startsWith(`<Dynamic`) ? output : `<app-panel class={css.class}>${output}</app-panel>`}
}
export function render() {
	return <AppPanel ready={true} children={<aside />} fallback={<aside />} />
}`,
}))
