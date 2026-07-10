export const FIX_COURSE_DRILL_COUNT = 12

export type FixCourseLessonStage =
	| `fundamentals`
	| `selector-lists`
	| `safety`
	| `advanced`
	| `drill`

export type FixCourseLessonKind =
	| `full-dead-rule`
	| `mixed-selector-list`
	| `all-dead-selector-list`
	| `impossible-local-class`
	| `preservation`
	| `clean-no-op`
	| `missing-tsx-sibling`
	| `advanced-nesting`
	| `drill-deep-rule`
	| `drill-mixed-list`
	| `drill-impossible-class`
	| `drill-clean-map`

export type FixCourseLesson = {
	cohort: `core` | `drill`
	cssPath: string
	expectedAction: `changed` | `unchanged` | `skipped`
	expectedRemovedSelectors: string[]
	id: string
	kind: FixCourseLessonKind
	objective: string
	order: number
	stage: FixCourseLessonStage
	title: string
	tsxPath?: string
}

export type FixCourse = {
	expectedCss: Record<string, string>
	files: Record<string, string>
	lessons: FixCourseLesson[]
}

type LessonSpec = Omit<FixCourseLesson, `order`> & {
	expectedCss: string
	inputCss: string
	tsxSource?: string
}

const coreLessons: LessonSpec[] = [
	{
		cohort: `core`,
		cssPath: `course/01-full-dead-rule/FullDeadRule.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`training-full-dead.class > footer`],
		id: `01-full-dead-rule`,
		kind: `full-dead-rule`,
		objective: `Remove one unreachable rule without disturbing its live siblings.`,
		stage: `fundamentals`,
		title: `Clear the first obstacle`,
		tsxPath: `course/01-full-dead-rule/FullDeadRule.tsx`,
		tsxSource: `import css from "./FullDeadRule.module.css"

export function FullDeadRule() {
	return (
		<training-full-dead className={css.class}>
			<header />
			<main />
		</training-full-dead>
	)
}
`,
		inputCss: `training-full-dead.class {
	> header {
		display: block;
	}

	> main {
		min-width: 0;
	}

	> footer {
		display: none;
	}
}
`,
		expectedCss: `training-full-dead.class {
	> header {
		display: block;
	}

	> main {
		min-width: 0;
	}


}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/02-mixed-selector-list/MixedSelectorList.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`training-mixed-list.class > footer`],
		id: `02-mixed-selector-list`,
		kind: `mixed-selector-list`,
		objective: `Prune only the dead member of a selector list.`,
		stage: `selector-lists`,
		title: `Choose the live lane`,
		tsxPath: `course/02-mixed-selector-list/MixedSelectorList.tsx`,
		tsxSource: `import css from "./MixedSelectorList.module.css"

export function MixedSelectorList() {
	return (
		<training-mixed-list className={css.class}>
			<header />
			<main />
		</training-mixed-list>
	)
}
`,
		inputCss: `training-mixed-list.class {
	> header,
	> footer {
		padding: 1rem;
	}

	> main {
		min-width: 0;
	}
}
`,
		expectedCss: `training-mixed-list.class {
	> header {
		padding: 1rem;
	}

	> main {
		min-width: 0;
	}
}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/03-all-dead-selector-list/AllDeadSelectorList.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [
			`training-all-dead-list.class > aside`,
			`training-all-dead-list.class > footer`,
		],
		id: `03-all-dead-selector-list`,
		kind: `all-dead-selector-list`,
		objective: `Remove an entire rule when every selector-list member is dead.`,
		stage: `selector-lists`,
		title: `Retire an empty route`,
		tsxPath: `course/03-all-dead-selector-list/AllDeadSelectorList.tsx`,
		tsxSource: `import css from "./AllDeadSelectorList.module.css"

export function AllDeadSelectorList() {
	return (
		<training-all-dead-list className={css.class}>
			<header />
			<main />
		</training-all-dead-list>
	)
}
`,
		inputCss: `training-all-dead-list.class {
	> header {
		display: block;
	}

	> aside,
	> footer {
		visibility: hidden;
	}

	> main {
		min-width: 0;
	}
}
`,
		expectedCss: `training-all-dead-list.class {
	> header {
		display: block;
	}


	> main {
		min-width: 0;
	}
}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/04-impossible-local-class/ImpossibleLocalClass.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`training-impossible-class.class > .field-note`],
		id: `04-impossible-local-class`,
		kind: `impossible-local-class`,
		objective: `Remove a local class that the Lasertag module contract cannot expose.`,
		stage: `fundamentals`,
		title: `Drop impossible equipment`,
		tsxPath: `course/04-impossible-local-class/ImpossibleLocalClass.tsx`,
		tsxSource: `import css from "./ImpossibleLocalClass.module.css"

export function ImpossibleLocalClass() {
	return (
		<training-impossible-class className={css.class}>
			<label>
				<input />
			</label>
		</training-impossible-class>
	)
}
`,
		inputCss: `training-impossible-class.class {
	> label {
		display: grid;

		> input {
			min-width: 0;
		}
	}

	> .field-note {
		color: tomato;
	}
}
`,
		expectedCss: `training-impossible-class.class {
	> label {
		display: grid;

		> input {
			min-width: 0;
		}
	}


}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/05-preservation/Preservation.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`training-preservation.class > aside`],
		id: `05-comment-format-preservation`,
		kind: `preservation`,
		objective: `Keep comments and hand formatting byte-for-byte outside the deleted rule.`,
		stage: `safety`,
		title: `Leave the trail markers`,
		tsxPath: `course/05-preservation/Preservation.tsx`,
		tsxSource: `import css from "./Preservation.module.css"

export function Preservation() {
	return (
		<training-preservation className={css.class}>
			<header />
			<main />
			<footer />
		</training-preservation>
	)
}
`,
		inputCss: `/* course banner: preserve */
training-preservation.class {
	/* checkpoint alpha */
	> header { color: rebeccapurple; }

	> main {
		display: grid; /* declaration note */
	}

	> aside {
		outline: 3px dashed tomato;
	}

	/* checkpoint omega */
	> footer { color: seagreen; }
}
/* course footer: preserve */
`,
		expectedCss: `/* course banner: preserve */
training-preservation.class {
	/* checkpoint alpha */
	> header { color: rebeccapurple; }

	> main {
		display: grid; /* declaration note */
	}


	/* checkpoint omega */
	> footer { color: seagreen; }
}
/* course footer: preserve */
`,
	},
	{
		cohort: `core`,
		cssPath: `course/06-clean-no-op/CleanNoOp.module.css`,
		expectedAction: `unchanged`,
		expectedRemovedSelectors: [],
		id: `06-clean-no-op`,
		kind: `clean-no-op`,
		objective: `Prove a clean file is never rewritten.`,
		stage: `safety`,
		title: `Respect a clear course`,
		tsxPath: `course/06-clean-no-op/CleanNoOp.tsx`,
		tsxSource: `import css from "./CleanNoOp.module.css"

export function CleanNoOp() {
	return (
		<training-clean className={css.class}>
			<nav>
				<a href="/finish">Finish</a>
			</nav>
		</training-clean>
	)
}
`,
		inputCss: `training-clean.class {
	> nav {
		display: flex;

		> a {
			color: currentcolor;
		}
	}
}
`,
		expectedCss: `training-clean.class {
	> nav {
		display: flex;

		> a {
			color: currentcolor;
		}
	}
}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/07-missing-tsx/MissingTsx.module.css`,
		expectedAction: `skipped`,
		expectedRemovedSelectors: [],
		id: `07-missing-tsx-sibling`,
		kind: `missing-tsx-sibling`,
		objective: `Skip a CSS module whose sibling TSX file is absent.`,
		stage: `safety`,
		title: `Pass the unmanned station`,
		inputCss: `training-missing.class {
	> abandoned-marker {
		display: none;
	}
}
`,
		expectedCss: `training-missing.class {
	> abandoned-marker {
		display: none;
	}
}
`,
	},
	{
		cohort: `core`,
		cssPath: `course/08-advanced-nesting/AdvancedNesting.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [
			`training-advanced.class > main > ol > li > strong`,
		],
		id: `08-advanced-nesting`,
		kind: `advanced-nesting`,
		objective: `Follow a local component and map callback before pruning a deep dead branch.`,
		stage: `advanced`,
		title: `Read the whole route`,
		tsxPath: `course/08-advanced-nesting/AdvancedNesting.tsx`,
		tsxSource: `import css from "./AdvancedNesting.module.css"

function CheckpointList({ labels }: { labels: string[] }) {
	return (
		<ol>
			{labels.map((label) => (
				<li>
					<span>{label}</span>
				</li>
			))}
		</ol>
	)
}

export function AdvancedNesting() {
	return (
		<training-advanced className={css.class}>
			<header />
			<main>
				<CheckpointList labels={["start", "finish"]} />
			</main>
			<footer />
		</training-advanced>
	)
}
`,
		inputCss: `training-advanced.class {
	> header {}

	> main {
		> ol {
			> li {
				> span {}
				> strong {}
			}
		}
	}

	> footer {}
}
`,
		expectedCss: `training-advanced.class {
	> header {}

	> main {
		> ol {
			> li {
				> span {}

			}
		}
	}

	> footer {}
}
`,
	},
]

function drillNumber(index: number): string {
	return String(index + 1).padStart(2, `0`)
}

function createDeepRuleDrill(index: number): LessonSpec {
	const number = drillNumber(index)
	const componentName = `Drill${number}`
	const rootTag = `training-drill-${number}`
	const directory = `course/09-drills/drill-${number}`

	return {
		cohort: `drill`,
		cssPath: `${directory}/${componentName}.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`${rootTag}.class > main > aside`],
		id: `drill-${number}`,
		kind: `drill-deep-rule`,
		objective: `Prune a dead nested branch in drill ${number}.`,
		stage: `drill`,
		title: `Nested branch drill ${number}`,
		tsxPath: `${directory}/${componentName}.tsx`,
		tsxSource: `import css from "./${componentName}.module.css"

export function ${componentName}() {
	return (
		<${rootTag} className={css.class}>
			<header />
			<main>
				<p>Checkpoint ${number}</p>
			</main>
		</${rootTag}>
	)
}
`,
		inputCss: `${rootTag}.class {
	> header {}

	> main {
		> p {}
		> aside {}
	}
}
`,
		expectedCss: `${rootTag}.class {
	> header {}

	> main {
		> p {}

	}
}
`,
	}
}

function createMixedListDrill(index: number): LessonSpec {
	const number = drillNumber(index)
	const componentName = `Drill${number}`
	const rootTag = `training-drill-${number}`
	const directory = `course/09-drills/drill-${number}`

	return {
		cohort: `drill`,
		cssPath: `${directory}/${componentName}.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`${rootTag}.class > nav > button`],
		id: `drill-${number}`,
		kind: `drill-mixed-list`,
		objective: `Keep the live selector-list member in drill ${number}.`,
		stage: `drill`,
		title: `Selector list drill ${number}`,
		tsxPath: `${directory}/${componentName}.tsx`,
		tsxSource: `import css from "./${componentName}.module.css"

export function ${componentName}() {
	return (
		<${rootTag} className={css.class}>
			<nav>
				<a href="/drill-${number}">Drill ${number}</a>
			</nav>
		</${rootTag}>
	)
}
`,
		inputCss: `${rootTag}.class {
	> nav {
		> a,
		> button {
			color: currentcolor;
		}
	}
}
`,
		expectedCss: `${rootTag}.class {
	> nav {
		> a {
			color: currentcolor;
		}
	}
}
`,
	}
}

function createImpossibleClassDrill(index: number): LessonSpec {
	const number = drillNumber(index)
	const componentName = `Drill${number}`
	const rootTag = `training-drill-${number}`
	const directory = `course/09-drills/drill-${number}`

	return {
		cohort: `drill`,
		cssPath: `${directory}/${componentName}.module.css`,
		expectedAction: `changed`,
		expectedRemovedSelectors: [`${rootTag}.class > form > .hint`],
		id: `drill-${number}`,
		kind: `drill-impossible-class`,
		objective: `Remove an impossible local class in drill ${number}.`,
		stage: `drill`,
		title: `Local class drill ${number}`,
		tsxPath: `${directory}/${componentName}.tsx`,
		tsxSource: `import css from "./${componentName}.module.css"

export function ${componentName}() {
	return (
		<${rootTag} className={css.class}>
			<form>
				<label>
					<input />
				</label>
			</form>
		</${rootTag}>
	)
}
`,
		inputCss: `${rootTag}.class {
	> form {
		> label {
			> input {}
		}

		> .hint {}
	}
}
`,
		expectedCss: `${rootTag}.class {
	> form {
		> label {
			> input {}
		}


	}
}
`,
	}
}

function createCleanMapDrill(index: number): LessonSpec {
	const number = drillNumber(index)
	const componentName = `Drill${number}`
	const rootTag = `training-drill-${number}`
	const directory = `course/09-drills/drill-${number}`
	const css = `${rootTag}.class {
	> ol {
		> li {
			> span {}
		}
	}
}
`

	return {
		cohort: `drill`,
		cssPath: `${directory}/${componentName}.module.css`,
		expectedAction: `unchanged`,
		expectedRemovedSelectors: [],
		id: `drill-${number}`,
		kind: `drill-clean-map`,
		objective: `Recognize every mapped path as live in drill ${number}.`,
		stage: `drill`,
		title: `Mapped path drill ${number}`,
		tsxPath: `${directory}/${componentName}.tsx`,
		tsxSource: `import css from "./${componentName}.module.css"

export function ${componentName}({ items }: { items: string[] }) {
	return (
		<${rootTag} className={css.class}>
			<ol>
				{items.map((item) => (
					<li>
						<span>{item}</span>
					</li>
				))}
			</ol>
		</${rootTag}>
	)
}
`,
		inputCss: css,
		expectedCss: css,
	}
}

const drillFactories = [
	createDeepRuleDrill,
	createMixedListDrill,
	createImpossibleClassDrill,
	createCleanMapDrill,
] as const

function createDrillLessons(): LessonSpec[] {
	return Array.from({ length: FIX_COURSE_DRILL_COUNT }, (_, index) => {
		const factory = drillFactories[index % drillFactories.length]

		if (!factory) throw new Error(`Missing drill factory for index ${index}.`)

		return factory(index)
	})
}

export function createFixCourse(): FixCourse {
	const specs = [...coreLessons, ...createDrillLessons()]
	const fileEntries: Array<[string, string]> = []
	const expectedCssEntries: Array<[string, string]> = []
	const lessons: FixCourseLesson[] = []
	const seenPaths = new Set<string>()

	for (const [index, spec] of specs.entries()) {
		const { expectedCss, inputCss, tsxSource, ...lesson } = spec
		const paths =
			tsxSource && lesson.tsxPath
				? [lesson.cssPath, lesson.tsxPath]
				: [lesson.cssPath]

		for (const filePath of paths) {
			if (seenPaths.has(filePath)) {
				throw new Error(`Duplicate fix-course path: ${filePath}`)
			}

			seenPaths.add(filePath)
		}

		fileEntries.push([lesson.cssPath, inputCss])
		expectedCssEntries.push([lesson.cssPath, expectedCss])

		if (tsxSource && lesson.tsxPath) {
			fileEntries.push([lesson.tsxPath, tsxSource])
		}

		lessons.push({
			...lesson,
			expectedRemovedSelectors: [...lesson.expectedRemovedSelectors],
			order: index + 1,
		})
	}

	return {
		expectedCss: Object.fromEntries(expectedCssEntries),
		files: Object.fromEntries(fileEntries),
		lessons,
	}
}
