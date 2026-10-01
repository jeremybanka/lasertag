import "lasertag/css-modules"
import "lasertag/react-jsx"

import * as React from "react"

import css from "./ProjectCard.module.css"

export function ProjectCard() {
	const ref = React.createRef<HTMLElement>()
	return (
		<project-card
			className={css.class}
			ref={ref}
			aria-label="Reports"
			data-example="react"
		>
			<React.Fragment>
				<button type="button" disabled={false}>
					Refresh
				</button>
				<status-label className={css.class}>Ready</status-label>
			</React.Fragment>
		</project-card>
	)
}

const attributes: React.JSX.IntrinsicElements[`project-card`] = {
	className: css.class,
}
void attributes

// @ts-expect-error React custom-element classes must be strings.
const invalidClass = <project-card className={123} />
void invalidClass

// @ts-expect-error Native elements keep React's existing attribute types.
const invalidButton = <button disabled="yes" />
void invalidButton

// @ts-expect-error Custom element names must contain a hyphen.
const invalidTag = <widget />
void invalidTag

// @ts-expect-error Lasertag exposes only the root CSS Module class.
const invalidModuleClass = css.other
void invalidModuleClass
