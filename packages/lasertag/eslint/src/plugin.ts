import type { ESLint } from "eslint"

import * as Rules from "./rules.ts"

export { Rules }

const plugin: ESLint.Plugin = {
	rules: {
		"access-css-module-class-only": Rules.accessCssModuleClassOnly,
		"ban-div": Rules.banDiv,
		"export-own-component-only": Rules.exportOwnComponentOnly,
		"header-main-footer-as-group": Rules.headerMainFooterAsGroup,
		"import-own-css-module-only": Rules.importOwnCssModuleOnly,
		"name-imported-css-module-as-css": Rules.nameImportedCssModuleAsCss,
		"render-tag-with-own-name": Rules.renderTagWithOwnName,
	},
} satisfies ESLint.Plugin

export default plugin
