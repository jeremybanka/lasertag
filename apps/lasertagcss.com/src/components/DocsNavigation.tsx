import type { VNode } from "preact"
import * as React from "react"

import css from "./DocsNavigation.module.css"
import { DynamicSpotlight } from "./DynamicSpotlight.tsx"
import { Toggle } from "./Toggle.tsx"

type HeadingDescriptor = {
	content: string | null
	id: string
	level: number
}

function usePathname(): string {
	const [pathname, setPathname] = React.useState(
		globalThis.location?.pathname ?? `/docs`,
	)
	React.useEffect(() => {
		const updatePathname = () => setPathname(window.location.pathname)
		document.addEventListener(`astro:page-load`, updatePathname)
		return () => document.removeEventListener(`astro:page-load`, updatePathname)
	}, [])
	return pathname
}

export function DocsNavigation(): VNode {
	const pathname = usePathname()
	const [menuIsOpen, setMenuIsOpen] = React.useState(false)
	React.useEffect(() => setMenuIsOpen(false), [pathname])

	return (
		<docs-navigation class={css.class}>
			<SiteDirectory menuIsOpen={menuIsOpen} pathname={pathname} />
			<OnThisPage menuIsOpen={menuIsOpen} pathname={pathname} />
			<menu-toggle>
				<Toggle.Button
					ariaControls="site-directory on-this-page"
					ariaLabel="Documentation menu"
					checked={menuIsOpen}
					onClick={() => setMenuIsOpen((open) => !open)}
				>
					☰
				</Toggle.Button>
			</menu-toggle>
		</docs-navigation>
	)
}

type NavigationPanelProps = {
	menuIsOpen: boolean
	pathname: string
}

function OnThisPage({ menuIsOpen, pathname }: NavigationPanelProps): VNode {
	const elementRef = React.useRef<HTMLElement>(null)
	const [headings, setHeadings] = React.useState<HeadingDescriptor[]>([])
	const [activeHeadingId, setActiveHeadingId] = React.useState<string | null>(
		null,
	)

	React.useEffect(() => {
		const elements = Array.from(
			document.querySelectorAll<HTMLElement>(`article h2[id], article h3[id]`),
		)
		setHeadings(
			elements.map((element) => ({
				content: element.textContent,
				id: element.id,
				level: Number.parseInt(element.tagName.slice(1), 10),
			})),
		)

		const updateActiveHeading = () => {
			const scrollPadding = Number.parseFloat(
				getComputedStyle(document.documentElement).scrollPaddingTop,
			)
			let active = elements[0]?.id ?? null
			for (const element of elements) {
				if (element.getBoundingClientRect().top <= scrollPadding + 1) {
					active = element.id
				}
			}
			setActiveHeadingId(active)
		}

		updateActiveHeading()
		addEventListener(`resize`, updateActiveHeading)
		addEventListener(`scroll`, updateActiveHeading, { passive: true })
		return () => {
			removeEventListener(`resize`, updateActiveHeading)
			removeEventListener(`scroll`, updateActiveHeading)
		}
	}, [pathname])

	return (
		<on-this-page data-menu-is-open={menuIsOpen}>
			<nav id="on-this-page" ref={elementRef}>
				<DynamicSpotlight
					elementId="on-this-page"
					parentRef={elementRef}
					updateSignals={[menuIsOpen, pathname, headings]}
					variant="surface"
					hiddenAtViewportWidth={1280}
				/>
				<DynamicSpotlight
					elementId={activeHeadingId ? `${activeHeadingId}-link` : null}
					parentRef={elementRef}
					updateSignals={[menuIsOpen, pathname, headings]}
				/>
				<section>
					<header>On this page</header>
					<main>
						{headings.map((heading) => (
							<section data-heading-level={heading.level} key={heading.id}>
								<a href={`#${heading.id}`} id={`${heading.id}-link`}>
									{heading.content}
								</a>
							</section>
						))}
					</main>
				</section>
			</nav>
		</on-this-page>
	)
}

function SiteDirectory({ menuIsOpen, pathname }: NavigationPanelProps): VNode {
	const elementRef = React.useRef<HTMLElement>(null)
	const pathnameId =
		(pathname.endsWith(`/`) ? pathname.slice(0, -1) : pathname).replaceAll(
			`/`,
			`-`,
		) + `-link`

	return (
		<site-directory data-menu-is-open={menuIsOpen}>
			<nav id="site-directory" ref={elementRef}>
				<DynamicSpotlight
					elementId="site-directory"
					parentRef={elementRef}
					updateSignals={[menuIsOpen, pathname]}
					variant="surface"
					hiddenAtViewportWidth={960}
				/>
				<DynamicSpotlight
					elementId={pathnameId}
					parentRef={elementRef}
					updateSignals={[menuIsOpen, pathname]}
				/>
				<section>
					<header>Start</header>
					<main>
						<section>
							<a id="-docs-link" href="/docs">
								understand lasertag
							</a>
						</section>
						<section>
							<a id="-docs-getting-started-link" href="/docs/getting-started">
								getting started
							</a>
						</section>
						<section>
							<a id="-docs-core-model-link" href="/docs/core-model">
								core model
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Use</header>
					<main>
						<section>
							<a id="-docs-authoring-link" href="/docs/authoring">
								authoring components
							</a>
						</section>
						<section>
							<a id="-docs-composition-link" href="/docs/composition">
								composition & ownership
							</a>
						</section>
						<section>
							<a id="-docs-frameworks-link" href="/docs/frameworks">
								frameworks
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Tools</header>
					<main>
						<section>
							<a id="-docs-tooling-link" href="/docs/tooling">
								CLI & editor
							</a>
						</section>
						<section>
							<a id="-docs-diagnostics-link" href="/docs/diagnostics">
								diagnostics
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Deep dive</header>
					<main>
						<section>
							<a id="-docs-how-it-works-link" href="/docs/how-it-works">
								how it works
							</a>
						</section>
						<section>
							<a id="-docs-exhibits-link" href="/docs/exhibits">
								exhibits
							</a>
						</section>
					</main>
				</section>
			</nav>
		</site-directory>
	)
}
