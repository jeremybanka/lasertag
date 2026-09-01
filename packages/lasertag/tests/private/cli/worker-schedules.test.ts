import { afterEach, expect, it } from "vitest"

import { runLasertagCli } from "../../../src/cli/main.ts"
import { cleanUpFixtures, createFixture, createTestIO } from "./test-support.ts"

afterEach(cleanUpFixtures)

it(`keeps imported root evidence stable across worker schedules`, async () => {
	const files: Record<string, string> = {
		"src/KerningTile.module.css": `
			kerning-tile.class {
				> label {
					/* @lasertag-expect-error: NumericInput cannot render a span */
					> span {}
				}
			}
		`,
		"src/KerningTile.tsx": `
			import { NumericInput } from "./NumericInput.tsx"
			import css from "./KerningTile.module.css"

			export function KerningTile() {
				return (
					<kerning-tile className={css.class}>
						<label>
							<span>Amount</span>
							<NumericInput />
						</label>
					</kerning-tile>
				)
			}
		`,
		"src/NumericInput.module.css": `numeric-input.class {}`,
		"src/NumericInput.tsx": `
			import css from "./NumericInput.module.css"

			export function NumericInput() {
				return <numeric-input className={css.class} />
			}
		`,
	}
	const placeholderNames = [
		`AlphaPanel`,
		`BravoPanel`,
		`CharliePanel`,
		`DeltaPanel`,
		`EchoPanel`,
		`FoxtrotPanel`,
		`GolfPanel`,
		`HotelPanel`,
		`OscarPanel`,
		`PapaPanel`,
		`QuebecPanel`,
		`RomeoPanel`,
		`SierraPanel`,
		`TangoPanel`,
		`UniformPanel`,
		`VictorPanel`,
		`WhiskeyPanel`,
		`XrayPanel`,
	]

	for (const name of placeholderNames) {
		files[`src/${name}.module.css`] = `placeholder-panel.class {}`
		files[`src/${name}.tsx`] =
			`export function ${name}() { return <placeholder-panel /> }`
	}

	const fixture = createFixture(files)
	const diagnosticsByWorkerCount = new Map<number, string[]>()

	for (const workerCount of [1, 2]) {
		const { io } = createTestIO()
		const result = await runLasertagCli([`lasertag`, `check`], io, {
			checkWorkerCount: workerCount,
			cwd: fixture.root,
		})

		diagnosticsByWorkerCount.set(
			workerCount,
			result.diagnostics
				.filter(
					(diagnostic) =>
						diagnostic.cssPath === fixture.path(`src/KerningTile.module.css`),
				)
				.map((diagnostic) => String(diagnostic.code)),
		)
	}

	expect(diagnosticsByWorkerCount).toEqual(
		new Map([
			[1, [`unused-expect-error`]],
			[2, [`unused-expect-error`]],
		]),
	)
})
