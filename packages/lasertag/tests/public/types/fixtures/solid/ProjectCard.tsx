import "lasertag/css-modules"
import "lasertag/solid-jsx"

import { For, Show, createSignal } from "solid-js"
import type { JSX } from "solid-js"

import css from "./ProjectCard.module.css"

export function ProjectCard() {
	const [ready, setReady] = createSignal(false)
	return (
		<project-card class={css.class} aria-label="Reports" data-example="solid">
			<button type="button" disabled={false} onClick={() => setReady(true)}>
				Refresh
			</button>
			<Show when={ready()}>
				<For each={[`Ready`]}>
					{(status) => <status-label class={css.class}>{status}</status-label>}
				</For>
			</Show>
		</project-card>
	)
}

const attributes: JSX.IntrinsicElements[`project-card`] = { class: css.class }
void attributes

// @ts-expect-error Solid custom-element classes must be strings.
const invalidClass = <project-card class={123} />
void invalidClass

// @ts-expect-error Native elements keep Solid's existing attribute types.
const invalidButton = <button disabled="yes" />
void invalidButton

// @ts-expect-error Custom element names must contain a hyphen.
const invalidTag = <widget />
void invalidTag

// @ts-expect-error Lasertag exposes only the root CSS Module class.
const invalidModuleClass = css.other
void invalidModuleClass
