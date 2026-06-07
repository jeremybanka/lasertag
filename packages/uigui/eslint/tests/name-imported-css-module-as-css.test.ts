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
			errors: [{ message }],
		},
		{
			name: `ban namespace css module imports`,
			code: `import * as styles from "./App.module.css"`,
			errors: [{ message }],
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
