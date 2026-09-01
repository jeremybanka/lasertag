import { renderTagWithOwnName } from "../../../src/eslint/rules/render-tag-with-own-name.ts"
import { ruleTester } from "./rule-tester.ts"

const message = (componentName: string, expectedTagName: string) =>
	`Expected component function \`${componentName}\` to return JSX with outermost tag <${expectedTagName}>.`

ruleTester.run(`render-tag-with-own-name`, renderTagWithOwnName, {
	valid: [
		{
			name: `allow function component rendering matching custom tag`,
			code: `
				export function AppHeaderBar() {
					return <app-header-bar />
				}
			`,
		},
		{
			name: `allow const component rendering matching custom tag`,
			code: `export const ProjectList = () => <project-list />`,
		},
		{
			name: `allow block-bodied arrow component rendering matching custom tag`,
			code: `
				export const ProjectList = () => {
					return <project-list />
				}
			`,
		},
		{
			name: `allow matching roots across nested control-flow returns`,
			code: `
				export function ProjectList({ mode, projects }) {
					if (mode === "empty") {
						return <project-list />
					}

					switch (mode) {
						case "grid":
							return <project-list />
						default:
							for (const project of projects) {
								if (project.featured) {
									return <project-list />
								}
							}
					}

					return <project-list />
				}
			`,
		},
		{
			name: `ignore returns inside nested functions`,
			code: `
				export function ProjectList({ projects }) {
					projects.map((project) => {
						return <wrong-tag project={project} />
					})

					return <project-list />
				}
			`,
		},
		{
			name: `ignore local components that are not exported`,
			code: `const AppHeaderBar = () => <wrong-tag />`,
		},
		{
			name: `ignore local components when all component functions check is off`,
			code: `const AppHeaderBar = () => <wrong-tag />`,
			options: [{ checkAllComponentFunctions: false }],
		},
		{
			name: `allow local function component with matching tag when all component functions check is on`,
			code: `
				function AppHeaderBar() {
					return <app-header-bar />
				}
			`,
			options: [{ checkAllComponentFunctions: true }],
		},
		{
			name: `allow local arrow component with matching tag when all component functions check is on`,
			code: `const ProjectList = () => <project-list />`,
			options: [{ checkAllComponentFunctions: true }],
		},
		{
			name: `ignore non-PascalCase functions when all component functions check is on`,
			code: `
				function formatProject() {
					return <wrong-tag />
				}

				const renderProject = () => <wrong-tag />
			`,
			options: [{ checkAllComponentFunctions: true }],
		},
	],
	invalid: [
		{
			name: `ban function component rendering the wrong custom tag`,
			code: `
				export function AppHeaderBar() {
					return <header-bar />
				}
			`,
			errors: [{ message: message(`AppHeaderBar`, `app-header-bar`) }],
		},
		{
			name: `ban const component rendering the wrong custom tag`,
			code: `export const ProjectList = () => <projects />`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban exported component rendering the wrong custom tag when all component functions check is on`,
			code: `export const ProjectList = () => <projects />`,
			options: [{ checkAllComponentFunctions: true }],
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `report only the wrong root tag name`,
			code: `export const ProjectList = () => <article data-kind="project"><span /></article>`,
			errors: [
				{
					message: message(`ProjectList`, `project-list`),
					line: 1,
					column: 35,
					endLine: 1,
					endColumn: 42,
				},
			],
		},
		{
			name: `ban semantic non-form root elements`,
			code: `
				export function ProjectList() {
					return <section />
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban fragments as the root`,
			code: `
				export function ProjectList() {
					return <>No root tag</>
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban form control root elements`,
			code: `
				export const Checkbox = () => (
					<label>
						<input type="checkbox" />
					</label>
				)
			`,
			errors: [{ message: message(`Checkbox`, `checkbox`) }],
		},
		{
			name: `ban null returns`,
			code: `
				export function ProjectList() {
					return null
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban non-jsx returns`,
			code: `
				export function ProjectList() {
					return items.length
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban conditional expression returns`,
			code: `
				export function ProjectList({ isEmpty }) {
					return isEmpty ? <project-list /> : <project-list />
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban wrong roots returned from nested if statements`,
			code: `
				export function ProjectList({ isEmpty }) {
					if (isEmpty) {
						return <empty-state />
					}

					return <project-list />
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban wrong roots returned from switch cases`,
			code: `
				export function ProjectList({ mode }) {
					switch (mode) {
						case "grid":
							return <project-grid />
						default:
							return <project-list />
					}
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban wrong roots returned from loops`,
			code: `
				export function ProjectList({ projects }) {
					for (const project of projects) {
						if (project.featured) {
							return <featured-projects />
						}
					}

					return <project-list />
				}
			`,
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban local function component rendering the wrong tag when all component functions check is on`,
			code: `
				function AppHeaderBar() {
					return <header-bar />
				}
			`,
			options: [{ checkAllComponentFunctions: true }],
			errors: [{ message: message(`AppHeaderBar`, `app-header-bar`) }],
		},
		{
			name: `ban local arrow component rendering the wrong tag when all component functions check is on`,
			code: `const ProjectList = () => <projects />`,
			options: [{ checkAllComponentFunctions: true }],
			errors: [{ message: message(`ProjectList`, `project-list`) }],
		},
		{
			name: `ban local function expression component rendering the wrong tag when all component functions check is on`,
			code: `
				const AppHeaderBar = function () {
					return <header-bar />
				}
			`,
			options: [{ checkAllComponentFunctions: true }],
			errors: [{ message: message(`AppHeaderBar`, `app-header-bar`) }],
		},
	],
})
