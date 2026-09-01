import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { setEnvironmentData } from "node:worker_threads"

import { expect, it } from "vitest"

import { runWorkStealing } from "../../../src/cli/work-stealing.ts"

it(`lets workers release their resources before rejecting`, async () => {
	const markerDirectory = mkdtempSync(
		path.join(tmpdir(), `lasertag-worker-cleanup-`),
	)

	try {
		setEnvironmentData(`lasertag-test-marker-directory`, markerDirectory)

		await expect(
			runWorkStealing({
				files: [`first.module.css`, `second.module.css`],
				onProgress: () => {
					throw new Error(`training progress failed`)
				},
				operation: `check`,
				processSerial: () => {
					throw new Error(`expected worker execution`)
				},
				workerCount: 2,
				workerModuleUrl: new URL(
					`./work-stealing-cleanup-worker.ts`,
					import.meta.url,
				),
			}),
		).rejects.toThrow(`training progress failed`)

		const markers = readdirSync(markerDirectory)

		expect(
			markers.filter((marker) => marker.startsWith(`ready-`)),
		).toHaveLength(2)
		expect(
			markers.filter((marker) => marker.startsWith(`closed-`)),
		).toHaveLength(2)
	} finally {
		setEnvironmentData(`lasertag-test-marker-directory`, undefined)
		rmSync(markerDirectory, { force: true, recursive: true })
	}
})
