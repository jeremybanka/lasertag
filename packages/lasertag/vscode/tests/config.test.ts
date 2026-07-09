import { describe, expect, it } from "vitest"

import {
	LASERTAG_TYPESCRIPT_SDK_PATH,
	resolveWorkspacePath,
	withTypescriptSdkPathEnvironment,
} from "../config.ts"

describe(`VSCode extension configuration`, () => {
	it(`resolves absolute TypeScript SDK paths unchanged`, () => {
		expect(resolveWorkspacePath(`/opt/typescript/lib/tsc`, `/workspace`)).toBe(
			`/opt/typescript/lib/tsc`,
		)
	})

	it(`resolves relative TypeScript SDK paths from the workspace root`, () => {
		expect(resolveWorkspacePath(`.bin/typescript/tsc`, `/workspace`)).toBe(
			`/workspace/.bin/typescript/tsc`,
		)
	})

	it(`preserves fallback behavior when the TypeScript SDK path is empty`, () => {
		expect(resolveWorkspacePath(` `, `/workspace`)).toBeUndefined()
	})

	it(`propagates the TypeScript SDK path into the server environment`, () => {
		expect(
			withTypescriptSdkPathEnvironment(
				{ LASERTAG_LSP_LOG_LEVEL: `info` },
				`/workspace/.bin/typescript/tsc`,
			),
		).toEqual({
			LASERTAG_LSP_LOG_LEVEL: `info`,
			[LASERTAG_TYPESCRIPT_SDK_PATH]: `/workspace/.bin/typescript/tsc`,
		})
	})
})
