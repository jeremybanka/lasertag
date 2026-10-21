import { readFileSync } from "node:fs"
import path from "node:path"

import { analyzeCssOwnershipEvidence } from "../packages/lasertag/src/refractor/css-ownership-evidence.ts"

const [flag, filePath, ...extra] = process.argv.slice(2)
if (
	flag !== `--runExternalCode` ||
	!filePath ||
	extra.length ||
	!/\.(tsx|astro)$/.test(filePath)
) {
	console.error(
		`Usage: node scripts/inspect-css-ownership.node.ts --runExternalCode <component.tsx|component.astro>`,
	)
	process.exitCode = 1
} else {
	const sourcePath = path.resolve(filePath)
	const result = analyzeCssOwnershipEvidence({
		sourcePath,
		sourceText: readFileSync(sourcePath, `utf8`),
		runExternalCode: true,
	})
	console.log(JSON.stringify(result, null, 2))
	if (result.ownership.status === `unavailable`) process.exitCode = 1
}
