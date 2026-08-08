import { chamfer, createClipPathfinder, useSize } from "corners"
import { type ComponentChildren, type VNode } from "preact"
import * as React from "react"

import css from "./ResponsiveNavPanel.module.css"

const findPanelPath = createClipPathfinder(14, chamfer, null, chamfer, null)

type ResponsiveNavPanelProps = {
	children?: ComponentChildren
	side: `left` | `right`
}

export function ResponsiveNavPanel({
	children,
	side,
}: ResponsiveNavPanelProps): VNode {
	const panelRef = React.useRef<HTMLElement>(null)
	const pathId = `nav-panel-${React.useId().replaceAll(`:`, ``)}`
	const { height, width } = useSize(panelRef as React.RefObject<HTMLElement>)
	const path = findPanelPath(height, width)

	return (
		<responsive-nav-panel
			class={css.class}
			data-side={side}
			ref={panelRef}
			style={path ? { clipPath: `url(#${pathId})` } : undefined}
		>
			<svg width="0" height="0" aria-hidden="true">
				<clipPath id={pathId} clipPathUnits="objectBoundingBox">
					<path d={path} />
				</clipPath>
			</svg>
			{children}
		</responsive-nav-panel>
	)
}
