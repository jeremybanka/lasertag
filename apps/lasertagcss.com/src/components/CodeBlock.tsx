import { type ComponentChildren, toChildArray, type VNode } from "preact"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"

import css from "./CodeBlock.module.css"

const pre = { SyntaxHighlighter }

type CodeBlockProps = {
	children?: ComponentChildren
	code?: string
	filepath?: string
	label?: string
	soft?: boolean
}

function getLanguage(filepath?: string): string {
	const extension = filepath?.split(`.`).pop()
	switch (extension) {
		case `css`:
			return `css`
		case `sh`:
			return `bash`
		case `ts`:
			return `ts`
		case `tsx`:
			return `tsx`
		case `astro`:
			return `astro`
		default:
			return `tsx`
	}
}

function getCodeBlockId(labelOrHref: string): string {
	const label =
		labelOrHref
			.replace(/^["']|["']$/g, ``)
			.split(`/`)
			.pop() ?? ``
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, `-`)
		.replace(/^-+|-+$/g, ``)
}

function flattenChildrenToString(children: ComponentChildren): string {
	return toChildArray(children)
		.map((child) => {
			if (typeof child === `string` || typeof child === `number`) {
				return String(child)
			}
			return Array.isArray(child) ? flattenChildrenToString(child) : ``
		})
		.join(``)
}

export function CodeBlock({
	children,
	code: codeProp,
	filepath,
	label,
	soft = false,
}: CodeBlockProps): VNode {
	const displayLabel = label ?? filepath ?? `code`
	const code = codeProp ?? flattenChildrenToString(children)

	return (
		<code-block id={getCodeBlockId(displayLabel)} class={css.class}>
			<back-fill class={soft ? `soft` : `hard`} />
			<file-name>
				<span>{displayLabel}</span>
				<button type="button" aria-label={`Copy ${displayLabel}`}>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M15 5v10H5V5h10m1-1H4v12h12V4Z" />
						<path d="M3 11H1V1h10v2h1V0H0v12h3v-1Z" />
					</svg>
				</button>
			</file-name>
			<pre.SyntaxHighlighter
				language={getLanguage(filepath)}
				useInlineStyles={false}
			>
				{code}
			</pre.SyntaxHighlighter>
		</code-block>
	)
}
