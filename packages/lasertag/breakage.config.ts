import { changesetsReleaseDelta } from "@breakage/changesets"
import { defineConfig, semverPolicy, type BreakageConfig } from "breakage"

const config: BreakageConfig = defineConfig({
	tagPattern: "refs/tags/lasertag@",
	testPattern: "tests/public/**",
	test: "pnpm run test:public",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
})

export default config
