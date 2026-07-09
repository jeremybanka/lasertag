import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildLasertagVsix } from "../cli/src/vsix.ts"

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptsRoot, "..")
const outdir = path.join(packageRoot, "dist")

const result = await buildLasertagVsix({ outdir, packageRoot })

console.log(`created ${result.vsixPath}`)
