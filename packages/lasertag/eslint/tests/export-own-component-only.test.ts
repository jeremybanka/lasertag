import { exportOwnComponentOnly } from "../src/rules/export-own-component-only.ts"
import { ruleTester } from "./rule-tester.ts"

const message = `Export only the component that belongs to this file.`

ruleTester.run(`export-own-component-only`, exportOwnComponentOnly, {
	valid: [
		{
			name: `allow own function component export`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `export function AppHeaderBar() { return <app-header-bar /> }`,
		},
		{
			name: `allow own const component export`,
			filename: `/project/src/ProjectList.tsx`,
			code: `export const ProjectList = () => <project-list />`,
		},
		{
			name: `allow local helpers that are not exported`,
			filename: `/project/src/ProjectList.tsx`,
			code: `
				const formatCount = (count: number) => String(count)
				export const ProjectList = () => <project-list>{formatCount(1)}</project-list>
			`,
		},
		{
			name: `allow type exports`,
			filename: `/project/src/ProjectList.tsx`,
			code: `
				export type ProjectListProps = { count: number }
				export const ProjectList = (_props: ProjectListProps) => <project-list />
			`,
		},
	],
	invalid: [
		{
			name: `ban differently named function component export`,
			filename: `/project/src/AppHeaderBar.tsx`,
			code: `export function AppNav() { return <app-nav /> }`,
			errors: [{ message }],
		},
		{
			name: `ban helper value exports`,
			filename: `/project/src/ProjectList.tsx`,
			code: `
				export const formatCount = (count: number) => String(count)
				export const ProjectList = () => <project-list />
			`,
			errors: [{ message }],
		},
		{
			name: `ban export lists that include other values`,
			filename: `/project/src/ProjectList.tsx`,
			code: `
				const ProjectList = () => <project-list />
				const formatCount = (count: number) => String(count)
				export { ProjectList, formatCount }
			`,
			errors: [{ message }],
		},
		{
			name: `ban default exports`,
			filename: `/project/src/ProjectList.tsx`,
			code: `export default function ProjectList() { return <project-list /> }`,
			errors: [{ message }],
		},
	],
})
