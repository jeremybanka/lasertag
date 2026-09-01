import { importOwnCssModuleOnly } from "../../../src/eslint/rules/import-own-css-module-only.ts"
import { ruleTester } from "./rule-tester.ts"

const message = (expectedImport: string) =>
	`Expected CSS module import to be "${expectedImport}".`

ruleTester.run(`import-own-css-module-only`, importOwnCssModuleOnly, {
	valid: [
		{
			name: `allow component to import its own sibling css module`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `import css from "./AppHeaderBar.module.css"`,
		},
		{
			name: `allow lowercase component files`,
			filename: `/project/src/app-root.tsx`,
			code: `import css from "./app-root.module.css"`,
		},
		{
			name: `ignore non-css-module imports`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `
				import "./reset.css"
				import { AppNav } from "./AppNav.tsx"
			`,
		},
	],
	invalid: [
		{
			name: `ban importing another component css module`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `import css from "./AppNav.module.css"`,
			errors: [{ message: message(`./AppHeaderBar.module.css`) }],
		},
		{
			name: `ban importing css module from another directory`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `import css from "../shared/AppHeaderBar.module.css"`,
			errors: [{ message: message(`./AppHeaderBar.module.css`) }],
		},
		{
			name: `ban importing own-looking css module with a non-relative specifier`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `import css from "src/AppHeaderBar.module.css"`,
			errors: [{ message: message(`./AppHeaderBar.module.css`) }],
		},
	],
})
