import { ToggleButton } from "./ToggleButton.tsx"

export type ToggleProps = {
	ariaControls: string
	ariaLabel: string
	checked: boolean
	children: string
	onClick: () => void
	size?: { height: number; width: number }
}

export const Toggle = { Button: ToggleButton }
