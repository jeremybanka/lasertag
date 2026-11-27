import type { ESLint } from "eslint"

import {
	accessCssModuleClassOnly,
	attachCssClassToOwnTag,
	banDiv,
	exportOwnComponentOnly,
	headerMainFooterAsGroup,
	importOwnCssModuleOnly,
	nameImportedCssModuleAsCss,
	renderTagWithOwnName,
} from "./rules.ts"

export const Rules = {
	accessCssModuleClassOnly,
	attachCssClassToOwnTag,
	banDiv,
	exportOwnComponentOnly,
	headerMainFooterAsGroup,
	importOwnCssModuleOnly,
	nameImportedCssModuleAsCss,
	renderTagWithOwnName,
}

const plugin: ESLint.Plugin = {
	rules: {
		"access-css-module-class-only": accessCssModuleClassOnly,
		"attach-css-class-to-own-tag": attachCssClassToOwnTag,
		"ban-div": banDiv,
		"export-own-component-only": exportOwnComponentOnly,
		"header-main-footer-as-group": headerMainFooterAsGroup,
		"import-own-css-module-only": importOwnCssModuleOnly,
		"name-imported-css-module-as-css": nameImportedCssModuleAsCss,
		"render-tag-with-own-name": renderTagWithOwnName,
	},
} satisfies ESLint.Plugin

export default plugin
