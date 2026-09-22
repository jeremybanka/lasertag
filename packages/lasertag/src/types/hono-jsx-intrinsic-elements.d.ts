import type { JSX } from "hono/jsx"

// Use Hono's HTML attributes for hyphenated custom elements, including
// server-rendered attributes and HTMX attributes, without React types.
declare module "hono/jsx" {
	namespace JSX {
		interface IntrinsicElements {
			[tagname: `${string}-${string}` & {}]: JSX.HTMLAttributes
		}
	}
}
