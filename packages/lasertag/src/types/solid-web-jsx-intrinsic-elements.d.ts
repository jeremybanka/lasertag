import type { JSX } from "@solidjs/web/jsx-runtime"

/* oxlint-disable typescript/no-redundant-type-constituents -- The Solid 2 peer suite checks this declaration with the renderer installed. */
type CustomElementAttributes =
	| JSX.HTMLAttributes<HTMLElement>
	| JSX.SvgSVGAttributes<SVGElement>
	| JSX.MathMLAttributes<MathMLElement>

declare module "@solidjs/web/jsx-runtime" {
	namespace JSX {
		interface IntrinsicElements {
			[tagname: `${string}-${string}` & {}]: CustomElementAttributes
		}
	}
}
