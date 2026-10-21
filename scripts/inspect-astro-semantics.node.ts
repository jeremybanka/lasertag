import { readFileSync } from "node:fs"
import path from "node:path"

import { analyzeAstroSemanticEvidence } from "../packages/lasertag/src/refractor/astro-semantic-evidence.ts"

const [flag, filePath, ...extra] = process.argv.slice(2)
if (
	flag !== `--runExternalCode` ||
	!filePath ||
	extra.length ||
	!filePath.endsWith(`.astro`)
) {
	console.error(
		`Usage: node scripts/inspect-astro-semantics.node.ts --runExternalCode <component.astro>`,
	)
	process.exitCode = 1
} else {
	const absolutePath = path.resolve(filePath)
	const result = analyzeAstroSemanticEvidence({
		filePath: absolutePath,
		sourceText: readFileSync(absolutePath, `utf8`),
		runExternalCode: true,
	})
	console.log(JSON.stringify(result, null, 2))
	if (result.semantics.status === `unavailable`) process.exitCode = 1
}
