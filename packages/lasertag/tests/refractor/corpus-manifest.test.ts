import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const manifestPath = fileURLToPath(
	new URL(`corpus/manifest.json`, import.meta.url),
)

type CorpusManifest = {
	providers: Array<{
		name: string
		version: string
		renovate: {
			datasource: string
			packageName: string
			versioning: string
			extractVersion?: string
		}
		source: {
			kind: string
		}
		include: Array<{ from: string }>
	}>
}

describe(`refractor corpus manifest`, () => {
	const manifest = JSON.parse(
		readFileSync(manifestPath, `utf8`),
	) as CorpusManifest

	it(`seeds the first upstream corpus providers`, () => {
		expect(manifest.providers.map((provider) => provider.name)).toEqual([
			`mantine`,
			`radix-dialog`,
			`radix-slot`,
			`shadcn-ui`,
		])
	})

	it(`contains Renovate metadata for release tracking`, () => {
		for (const provider of manifest.providers) {
			expect(provider.version).toMatch(/\d+\.\d+\.\d+/)
			expect(provider.renovate.datasource).toMatch(/^(github-releases|npm)$/)
			expect(provider.renovate.packageName.length).toBeGreaterThan(0)
			expect(provider.renovate.versioning).toBe(`semver`)
			expect(provider.include.length).toBeGreaterThan(0)
		}
	})

	it(`uses npm sourcemaps for Radix because its repository has no release tags`, () => {
		const radixProviders = manifest.providers.filter((provider) =>
			provider.name.startsWith(`radix-`),
		)

		expect(radixProviders).toHaveLength(2)
		expect(
			radixProviders.every(
				(provider) =>
					provider.renovate.datasource === `npm` &&
					provider.source.kind === `npm-sourcemaps`,
			),
		).toBe(true)
	})

	it(`extracts shadcn versions from package-prefixed release tags`, () => {
		const shadcnProvider = manifest.providers.find(
			(provider) => provider.name === `shadcn-ui`,
		)

		expect(shadcnProvider?.renovate).toMatchObject({
			datasource: `github-releases`,
			extractVersion: `^shadcn@(?<version>.+)$`,
			packageName: `shadcn-ui/ui`,
		})
	})
})
