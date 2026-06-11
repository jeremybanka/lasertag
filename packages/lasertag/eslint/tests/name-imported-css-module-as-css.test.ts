import { nameImportedCssModuleAsCss } from "../src/rules/name-imported-css-module-as-css.ts"
import { ruleTester } from "./rule-tester.ts"

const message = `Import CSS modules with a default import named css.`

ruleTester.run(`name-imported-css-module-as-css`, nameImportedCssModuleAsCss, {
	valid: [
		{
			name: `allow css default import from a css module`,
			code: `import css from "./App.module.css"`,
		},
		{
			name: `ignore non-css-module imports`,
			code: `
				import styles from "./theme.css"
				import Button from "./Button.tsx"
			`,
		},
	],
	invalid: [
		{
			name: `ban another default import name`,
			code: `import styles from "./App.module.css"`,
			errors: [
				{
					message,
					line: 1,
					column: 8,
					endLine: 1,
					endColumn: 14,
				},
			],
		},
		{
			name: `ban namespace css module imports`,
			code: `import * as styles from "./App.module.css"`,
			errors: [{ message }],
		},
		{
			name: `report named css imports on the imported name`,
			code: `import { css } from "./MyComponent.module.css"`,
			errors: [
				{
					message,
					line: 1,
					column: 10,
					endLine: 1,
					endColumn: 13,
				},
			],
		},
		{
			name: `ban side-effect css module imports`,
			code: `import "./App.module.css"`,
			errors: [{ message }],
		},
		{
			name: `ban named css module imports`,
			code: `import { class as className } from "./App.module.css"`,
			errors: [{ message }],
		},
	],
})
