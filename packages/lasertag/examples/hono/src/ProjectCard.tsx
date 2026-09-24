import type { PropsWithChildren } from "hono/jsx"

import css from "./ProjectCard.module.css"

export function ProjectCard({
	children,
	name,
	reports,
}: PropsWithChildren<{ name: string; reports: string[] }>) {
	return (
		<project-card class={css.class}>
			<h2>{name}</h2>
			{reports.length > 0 ? (
				<ul>
					{reports.map((report) => (
						<li>{report}</li>
					))}
				</ul>
			) : (
				<p>No reports yet.</p>
			)}
			<button
				type="button"
				hx-get="/project"
				hx-target="closest project-card"
				hx-swap="outerHTML"
			>
				Refresh
			</button>
			<project-actions>{children}</project-actions>
		</project-card>
	)
}
