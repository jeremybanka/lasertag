import { describe, expect, it } from "vitest"

import {
	LASERTAG_TYPESCRIPT_SDK_PATH,
	resolveTypescriptSdkPath,
} from "../../../src/refractor/typescript-runtime.ts"

describe(`typescript runtime path resolution`, () => {
	it(`prefers an explicit TypeScript SDK path`, () => {
		expect(
			resolveTypescriptSdkPath({
				environment: {
					[LASERTAG_TYPESCRIPT_SDK_PATH]: `/from/env/tsc`,
				},
				typescriptSdkPath: ` /from/options/tsc `,
			}),
		).toBe(`/from/options/tsc`)
	})

	it(`falls back to the environment variable`, () => {
		expect(
			resolveTypescriptSdkPath({
				environment: {
					[LASERTAG_TYPESCRIPT_SDK_PATH]: ` /from/env/tsc `,
				},
			}),
		).toBe(`/from/env/tsc`)
	})

	it(`preserves the default TypeScript package resolution when unset`, () => {
		expect(resolveTypescriptSdkPath({ environment: {} })).toBeUndefined()
		expect(
			resolveTypescriptSdkPath({
				environment: {
					[LASERTAG_TYPESCRIPT_SDK_PATH]: ` `,
				},
				typescriptSdkPath: ` `,
			}),
		).toBeUndefined()
	})
})
