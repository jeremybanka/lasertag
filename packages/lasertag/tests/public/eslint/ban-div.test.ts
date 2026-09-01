import { banDiv } from "../../../src/eslint/rules/ban-div.ts"
import { ruleTester } from "./rule-tester.ts"

ruleTester.run(`ban-div`, banDiv, {
	valid: [
		{
			name: `allow semantic elements`,
			code: `
				const App = () => (
					<section>
						<header />
						<main />
						<footer />
					</section>
				)
			`,
		},
		{
			name: `allow descriptive custom elements`,
			code: `
				const App = () => (
					<app-root>
						<left-side />
						<project-summary />
					</app-root>
				)
			`,
		},
		{
			name: `allow components and member expressions`,
			code: `
				const App = () => (
					<AppShell>
						<Layout.Div />
					</AppShell>
				)
			`,
		},
	],
	invalid: [
		{
			name: `ban an opening div element`,
			code: `
				const App = () => (
					<div>
						<span />
					</div>
				)
			`,
			errors: [
				{
					message: `Do not use <div>. Use semantic HTML, a form control, or a descriptive custom element instead.`,
				},
			],
		},
		{
			name: `ban a self-closing div element`,
			code: `
				const App = () => <div />
			`,
			errors: [
				{
					message: `Do not use <div>. Use semantic HTML, a form control, or a descriptive custom element instead.`,
				},
			],
		},
		{
			name: `report every div in nested JSX`,
			code: `
				const App = () => (
					<section>
						<div>
							<div />
						</div>
					</section>
				)
			`,
			errors: [
				{
					message: `Do not use <div>. Use semantic HTML, a form control, or a descriptive custom element instead.`,
				},
				{
					message: `Do not use <div>. Use semantic HTML, a form control, or a descriptive custom element instead.`,
				},
			],
		},
	],
})
