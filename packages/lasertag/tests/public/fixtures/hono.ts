export const honoTsxSource = `
import { Fragment as Group } from "hono/jsx"
import { Suspense } from "hono/jsx/streaming"
import css from "./ProjectCard.module.css"

async function LocalReports() {
	await Promise.resolve()
	return <report-list />
}

export function ProjectCard() {
	return (
		<project-card class={css.class}>
			<Group>
				<Suspense fallback={<loading-state />}>
					<LocalReports />
				</Suspense>
			</Group>
		</project-card>
	)
}
`

export const honoCssSource = `project-card.class {
	> report-list { display: grid; }
	> loading-state { display: block; }
	> obsolete-state { display: none; }
}
`

export const cleanedHonoCssSource = `project-card.class {
	> report-list { display: grid; }
	> loading-state { display: block; }

}
`
