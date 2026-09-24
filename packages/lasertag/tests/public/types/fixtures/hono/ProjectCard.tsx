import "lasertag/css-modules"
import "lasertag/hono-jsx"

import { Hono } from "hono"
import type { JSX, PropsWithChildren } from "hono/jsx"
import { Suspense } from "hono/jsx/streaming"

import css from "./ProjectCard.module.css"

export async function ProjectCard({ children }: PropsWithChildren) {
	await Promise.resolve()
	return (
		<project-card class={css.class} aria-label="Reports" hx-get="/project">
			<button type="button" disabled={false}>
				Refresh
			</button>
			{children}
		</project-card>
	)
}

const attributes: JSX.IntrinsicElements[`project-card`] = { class: css.class }
void attributes

// @ts-expect-error Hono HTML class attributes must be strings or promises.
const invalidClass = <project-card class={123} />
void invalidClass

// @ts-expect-error Native elements keep Hono's existing attribute types.
const invalidButton = <button disabled="yes" />
void invalidButton

// @ts-expect-error Lasertag exposes only the root CSS Module class.
const invalidModuleClass = css.other
void invalidModuleClass

const app = new Hono()
app.get(`/`, (c) =>
	c.html(
		<Suspense fallback={<p>Loading</p>}>
			<ProjectCard />
		</Suspense>,
	),
)
