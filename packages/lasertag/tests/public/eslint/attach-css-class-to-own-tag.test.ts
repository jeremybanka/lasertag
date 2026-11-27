import { attachCssClassToOwnTag } from "../../../src/eslint/rules/attach-css-class-to-own-tag.ts"
import { ruleTester } from "./rule-tester.ts"

const attach = (tagName: string) =>
	`Expected <${tagName}> to carry this component's CSS module class: \`class={css.class}\` or \`className={css.class}\`.`

const importAndAttach = (tagName: string, expectedImport: string) =>
	`Expected <${tagName}> to carry this component's CSS module class: \`import css from "${expectedImport}"\`, then \`class={css.class}\` or \`className={css.class}\`.`

ruleTester.run(`attach-css-class-to-own-tag`, attachCssClassToOwnTag, {
	valid: [
		{
			name: `allow className={css.class} on the own-name root`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard() {
					return <project-card className={css.class} />
				}
			`,
		},
		{
			name: `allow class={css.class} on the own-name root`,
			code: `
				import css from "./ProjectCard.module.css"
				export const ProjectCard = () => <project-card class={css.class} />
			`,
		},
		{
			name: `allow css.class composed with other classes`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard(props) {
					return <project-card className={clsx(css.class, props.className)} />
				}
			`,
		},
		{
			name: `allow bracket access to the class export`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard() {
					return <project-card className={css["class"]} />
				}
			`,
		},
		{
			name: `allow template-literal bracket access inside a composed class`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard(props) {
					return <project-card class={\`\${css[\`class\`]} \${props.class ?? ""}\`} />
				}
			`,
		},
		{
			name: `allow every returned own-name root to carry the class`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard({ project }) {
					if (!project) return <project-card class={css.class} data-empty />

					return <project-card class={css.class}>{project.name}</project-card>
				}
			`,
		},
		{
			name: `leave a root with another tag to render-tag-with-own-name`,
			code: `
				export function ProjectCard() {
					return <article />
				}
			`,
		},
		{
			name: `ignore local components that are not exported`,
			code: `
				import css from "./ProjectCard.module.css"
				const ProjectRow = () => <project-row />
				export const ProjectCard = () => <project-card class={css.class}><ProjectRow /></project-card>
			`,
		},
	],
	invalid: [
		{
			name: `require the import and the class when the file has no CSS module`,
			filename: `/project/src/StorePickerControl.tsx`,
			code: `
				export function StorePickerControl() {
					return <store-picker-control data-store-picker />
				}
			`,
			errors: [
				{
					message: importAndAttach(
						`store-picker-control`,
						`./StorePickerControl.module.css`,
					),
				},
			],
		},
		{
			name: `require the class when the CSS module is imported but unused`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard() {
					return <project-card />
				}
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `report only the root tag name`,
			code: `export const ProjectCard = () => <project-card data-kind="project"><span /></project-card>`,
			filename: `/project/src/ProjectCard.tsx`,
			errors: [
				{
					message: importAndAttach(`project-card`, `./ProjectCard.module.css`),
					line: 1,
					column: 35,
					endLine: 1,
					endColumn: 47,
				},
			],
		},
		{
			name: `ban a literal class on the root`,
			code: `
				import css from "./ProjectCard.module.css"
				export const ProjectCard = () => <project-card class="project-card" />
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `ban a class that does not come from the CSS module`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard(props) {
					return <project-card className={props.class} />
				}
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `ban a local binding that shadows the CSS module`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard(props) {
					const css = props.theme
					return <project-card className={css.class} />
				}
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `ban attaching the class beneath the root instead of on it`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard() {
					return <project-card><section className={css.class} /></project-card>
				}
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `ban relying on a spread to supply the class`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard(props) {
					return <project-card {...props} />
				}
			`,
			errors: [{ message: attach(`project-card`) }],
		},
		{
			name: `report each returned root that lacks the class`,
			code: `
				import css from "./ProjectCard.module.css"
				export function ProjectCard({ project }) {
					if (!project) return <project-card data-empty />

					return <project-card class={css.class}>{project.name}</project-card>
				}
			`,
			errors: [{ message: attach(`project-card`), line: 4 }],
		},
	],
})
