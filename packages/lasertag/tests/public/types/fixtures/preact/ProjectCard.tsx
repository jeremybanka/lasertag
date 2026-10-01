import "lasertag/css-modules"
import "lasertag/preact-jsx"

import { Fragment } from "preact"
import type { JSX } from "preact"

import css from "./ProjectCard.module.css"

export function ProjectCard() {
	return (
		<project-card class={css.class} aria-label="Reports" data-example="preact">
			<Fragment>
				<button type="button" disabled={false}>
					Refresh
				</button>
				<status-label className={css.class}>Ready</status-label>
			</Fragment>
		</project-card>
	)
}

const attributes: JSX.IntrinsicElements[`project-card`] = { class: css.class }
void attributes

// @ts-expect-error Preact custom-element classes must be strings.
const invalidClass = <project-card class={123} />
void invalidClass

// @ts-expect-error Native elements keep Preact's existing attribute types.
const invalidButton = <button disabled="yes" />
void invalidButton

// @ts-expect-error Lasertag exposes only the root CSS Module class.
const invalidModuleClass = css.other
void invalidModuleClass
