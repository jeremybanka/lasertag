import { describe, expect, it } from "vitest"

import {
	LASERTAG_TYPESCRIPT_SDK_PATH,
	resolveBundledTypescriptSdkPath,
	resolveTypescriptSdkPath,
	resolveWorkspacePath,
	withTypescriptSdkPathEnvironment,
} from "../../../src/vscode/config.ts"

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

	it(`resolves the bundled TypeScript native executable path`, () => {
		expect(
			resolveBundledTypescriptSdkPath(`/extension`, `linux`, `arm64`),
		).toBe(
			`/extension/dist/node_modules/@typescript/typescript-linux-arm64/lib/tsc`,
		)
		expect(resolveBundledTypescriptSdkPath(`/extension`, `win32`, `x64`)).toBe(
			`/extension/dist/node_modules/@typescript/typescript-win32-x64/lib/tsc.exe`,
		)
	})

	it(`prefers configured TypeScript SDK paths over the bundled native executable`, () => {
		expect(
			resolveTypescriptSdkPath(
				`.bin/typescript/tsc`,
				`/workspace`,
				`/extension/dist/node_modules/@typescript/typescript-linux-arm64/lib/tsc`,
			),
		).toBe(`/workspace/.bin/typescript/tsc`)
	})

	it(`falls back to the bundled native executable when no TypeScript SDK path is configured`, () => {
		expect(
			resolveTypescriptSdkPath(
				` `,
				`/workspace`,
				`/extension/dist/node_modules/@typescript/typescript-linux-arm64/lib/tsc`,
			),
		).toBe(
			`/extension/dist/node_modules/@typescript/typescript-linux-arm64/lib/tsc`,
		)
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
