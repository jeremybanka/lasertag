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
	npm: {
		artifact: "artifacts/lasertag.tgz",
		representatives: "peer-environments/solid-*",
		lockfile: "package-lock.json",
		prepareCommand:
			"npm ci --ignore-scripts --workspaces=false --no-audit --no-fund",
		suites: {
			"solid-js": {
				files: [
					"tests/public/peer/solid/*",
					"tests/public/types/fixtures/solid/*",
				],
				command:
					"node --input-type=module-typescript < tests/public/peer/solid/contract.ts.fixture",
			},
		},
		baseline: { tagPattern: "refs/tags/lasertag@" },
	},
})

export default config
