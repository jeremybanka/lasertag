import type { JSX } from "solid-js"

type CustomElementAttributes =
	| JSX.HTMLAttributes<HTMLElement>
	| JSX.SvgSVGAttributes<SVGElement>
	| JSX.MathMLAttributes<MathMLElement>

// Allow arbitrary custom elements that follow the Custom Elements spec.
//
// In other words, this allows you to write `<my-element>` in your JSX.
//
// Supported by all evergreen browsers since ~2018 (Custom Elements v1).
//
// Per the HTML standard, custom element tag names must contain a hyphen
// to avoid collisions with present and future built-in elements.
// See: https://developer.mozilla.org/en-US/docs/Web/Web_Components/Using_custom_elements#custom_element_name_requirements
declare module "solid-js" {
	namespace JSX {
		interface IntrinsicElements {
			[tagname: `${string}-${string}` & {}]: CustomElementAttributes
		}
	}
}
