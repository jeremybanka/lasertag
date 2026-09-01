import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const fixtureRoots: string[] = []

export function cleanUpFixtures(): void {
	for (const root of fixtureRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true })
	}
}

export function createFixture(files: Record<string, string>) {
	const root = mkdtempSync(path.join(tmpdir(), `lasertag-cli-private-`))

	fixtureRoots.push(root)

	for (const [filePath, sourceText] of Object.entries(files)) {
		const absolutePath = path.join(root, filePath)

		mkdirSync(path.dirname(absolutePath), { recursive: true })
		writeFileSync(absolutePath, sourceText)
	}

	return {
		path: (filePath: string) => path.join(root, filePath),
		root,
	}
}

export function createTestIO({ echo = false }: { echo?: boolean } = {}) {
	const logs: string[] = []
	const errors: string[] = []

	return {
		errors,
		io: {
			error: (message: string) => {
				errors.push(message)
				if (echo) console.error(message)
			},
			log: (message: string) => {
				logs.push(message)
				if (echo) console.log(message)
			},
		},
		logs,
	}
}
