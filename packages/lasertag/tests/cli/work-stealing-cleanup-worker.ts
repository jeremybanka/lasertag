import { writeFileSync } from "node:fs"
import path from "node:path"
import { getEnvironmentData, workerData } from "node:worker_threads"

import {
	isLasertagWorkerData,
	runLasertagWorker,
} from "../../src/cli/work-stealing.ts"

const markerDirectory = getEnvironmentData(`lasertag-test-marker-directory`) as
	| string
	| undefined

if (isLasertagWorkerData(workerData) && markerDirectory) {
	const markerPath = (state: string) =>
		path.join(markerDirectory, `${state}-${workerData.workerId}`)

	writeFileSync(markerPath(`ready`), ``)

	try {
		await runLasertagWorker(workerData, (task, workerId) => ({
			...task,
			workerId,
		}))
	} finally {
		writeFileSync(markerPath(`closed`), ``)
	}
}
