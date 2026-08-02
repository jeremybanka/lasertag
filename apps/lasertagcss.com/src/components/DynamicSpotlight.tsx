import type { VNode } from "preact"
import * as React from "react"

import css from "./DynamicSpotlight.module.css"

export type ElementPosition = Pick<DOMRect, `height` | `left` | `top` | `width`>
export type SpotlightProps = {
	elementId?: null | string
	elementIds?: readonly string[]
	padding?: number
	parentRef?: React.RefObject<HTMLElement | null>
	startingPosition?: ElementPosition
	updateSignals?: unknown[]
	variant?: `surface` | `target`
	hiddenAtViewportWidth?: 960 | 1280
}

export function DynamicSpotlight({
	elementId = null,
	elementIds,
	padding = 0,
	parentRef,
	startingPosition = { top: 0, left: 0, width: 0, height: 0 },
	updateSignals = [],
	variant = `target`,
	hiddenAtViewportWidth,
}: SpotlightProps): VNode {
	const elementIdsKey = (elementIds ?? []).join(`\u0000`)
	const targetElementIds = React.useMemo(
		() => (elementIds ? [...elementIds] : elementId ? [elementId] : []),
		[elementId, elementIdsKey],
	)
	const [position, setPosition] = React.useState(startingPosition)

	React.useEffect(() => {
		const elements = targetElementIds.flatMap((id) => {
			const element = document.getElementById(id)
			return element ? [element] : []
		})
		if (elements.length === 0) {
			setPosition(startingPosition)
			return
		}

		const updatePosition = () => {
			const parentRect = parentRef?.current?.getBoundingClientRect()
			const targetRect = elements.reduce(
				(rect, element) => {
					const next = element.getBoundingClientRect()
					return {
						top: Math.min(rect.top, next.top),
						left: Math.min(rect.left, next.left),
						right: Math.max(rect.right, next.right),
						bottom: Math.max(rect.bottom, next.bottom),
					}
				},
				{
					top: Number.POSITIVE_INFINITY,
					left: Number.POSITIVE_INFINITY,
					right: Number.NEGATIVE_INFINITY,
					bottom: Number.NEGATIVE_INFINITY,
				},
			)
			setPosition({
				top: targetRect.top - (parentRect?.top ?? 0),
				left: targetRect.left - (parentRect?.left ?? 0),
				width: targetRect.right - targetRect.left,
				height: targetRect.bottom - targetRect.top,
			})
		}

		const observer = new ResizeObserver(updatePosition)
		for (const element of elements) observer.observe(element)
		if (parentRef?.current) observer.observe(parentRef.current)
		updatePosition()
		addEventListener(`resize`, updatePosition)
		addEventListener(`scroll`, updatePosition)
		return () => {
			removeEventListener(`resize`, updatePosition)
			removeEventListener(`scroll`, updatePosition)
			observer.disconnect()
		}
	}, [targetElementIds, parentRef, ...updateSignals])

	return (
		<dynamic-spotlight
			class={css.class}
			data-hidden-at-viewport-width={hiddenAtViewportWidth}
			data-spotlight-kind={variant}
			style={
				position.width === 0 || position.height === 0
					? { display: `none` }
					: {
							top: position.top - padding,
							left: position.left - padding,
							width: position.width + padding * 2,
							height: position.height + padding * 2,
						}
			}
		/>
	)
}
