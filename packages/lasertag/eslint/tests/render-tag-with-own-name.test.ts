import { renderTagWithOwnName } from "../src/rules/render-tag-with-own-name.ts"
import { ruleTester } from "./rule-tester.ts"

const message = `Exported components should render a root tag matching their own name, unless a native form control is the meaningful wrapper.`

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
			name: `allow form control root exceptions`,
			code: `
				export const Checkbox = () => (
					<label>
						<input type="checkbox" />
					</label>
				)
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
	],
	invalid: [
		{
			name: `ban function component rendering the wrong custom tag`,
			code: `
				export function AppHeaderBar() {
					return <header-bar />
				}
			`,
			errors: [{ message }],
		},
		{
			name: `ban const component rendering the wrong custom tag`,
			code: `export const ProjectList = () => <projects />`,
			errors: [{ message }],
		},
		{
			name: `ban semantic non-form root elements`,
			code: `
				export function ProjectList() {
					return <section />
				}
			`,
			errors: [{ message }],
		},
		{
			name: `ban fragments as the root`,
			code: `
				export function ProjectList() {
					return <>No root tag</>
				}
			`,
			errors: [{ message }],
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
			errors: [{ message }],
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
			errors: [{ message }],
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
			errors: [{ message }],
		},
	],
})
