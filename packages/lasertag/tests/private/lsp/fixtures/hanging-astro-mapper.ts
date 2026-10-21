import { writeFileSync } from "node:fs"

// Deliberately never answer initialize. EOF should release the mapper after the
// navigation worker and its TypeScript transport are stopped.
writeFileSync(process.argv[2]!, String(process.pid))
process.stdin.resume()
