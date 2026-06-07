import { headerMainFooterAsGroup } from "../src/rules/header-main-footer-as-group.ts"
import { ruleTester } from "./rule-tester.ts"

const message = `Use <header>, <main>, and <footer> only as a sibling group of two or more, with no unrelated element siblings.`

ruleTester.run(`header-main-footer-as-group`, headerMainFooterAsGroup, {
	valid: [
		{
			name: `allow header and main as siblings`,
			code: `
				const App = () => (
					<app-shell>
						<header />
						<main />
					</app-shell>
				)
			`,
		},
		{
			name: `allow main and footer as siblings`,
			code: `
				const App = () => (
					<app-shell>
						<main />
						<footer />
					</app-shell>
				)
			`,
		},
		{
			name: `allow header main and footer as siblings`,
			code: `
				const App = () => (
					<app-shell>
						<header />
						<main />
						<footer />
					</app-shell>
				)
			`,
		},
		{
			name: `ignore components and member expressions with similar names`,
			code: `
				const App = () => (
					<AppShell>
						<Header />
						<Layout.Main />
						<Footer />
					</AppShell>
				)
			`,
		},
	],
	invalid: [
		{
			name: `ban header by itself`,
			code: `
				const App = () => (
					<app-shell>
						<header />
					</app-shell>
				)
			`,
			errors: [{ message }],
		},
		{
			name: `ban footer by itself`,
			code: `
				const App = () => (
					<app-shell>
						<footer />
					</app-shell>
				)
			`,
			errors: [{ message }],
		},
		{
			name: `ban group mixed with unrelated element siblings`,
			code: `
				const App = () => (
					<app-shell>
						<header />
						<main />
						<nav />
					</app-shell>
				)
			`,
			errors: [{ message }, { message }],
		},
	],
})
