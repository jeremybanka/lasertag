import { accessCssModuleClassOnly } from "../src/rules/access-css-module-class-only.ts"
import { ruleTester } from "./rule-tester.ts"

const message = `Access only css.class from CSS module imports.`

ruleTester.run(`access-css-module-class-only`, accessCssModuleClassOnly, {
	valid: [
		{
			name: `allow class access on css module import`,
			code: `
				import css from "./App.module.css"

				const className = css.class
			`,
		},
		{
			name: `allow computed class access on css module import`,
			code: `
				import css from "./App.module.css"

				const className = css["class"]
			`,
		},
		{
			name: `allow template literal computed class access on css module import`,
			code: 'import css from "./App.module.css"\n\nconst className = css[`class`]',
		},
		{
			name: `ignore non-css-module member access`,
			code: `
				const css = { className: "x" }
				const className = css.className
			`,
		},
		{
			name: `ignore shadowed css module import name`,
			code: `
				import css from "./App.module.css"

				function getClassName(css: { className: string }) {
					return css.className
				}
			`,
		},
	],
	invalid: [
		{
			name: `ban className access on css module import`,
			code: `
				import css from "./App.module.css"

				const className = css.className
			`,
			errors: [{ message }],
		},
		{
			name: `ban other computed access on css module import`,
			code: `
				import css from "./App.module.css"

				const className = css["className"]
			`,
			errors: [{ message }],
		},
		{
			name: `ban optional member access other than class`,
			code: `
				import css from "./App.module.css"

				const className = css?.className
			`,
			errors: [{ message }],
		},
	],
})
