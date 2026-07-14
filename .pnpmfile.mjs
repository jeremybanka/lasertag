const TYPESCRIPT_FOR_VITE_PLUS_CORE = "6.0.3"
const TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8 = "6.0.3"

// Vite+ core's declaration bundler reads the TypeScript compiler API that
// TypeScript 7 no longer exposes from the package root. Remove this once Vite+
// supports TypeScript 7 for declaration generation.
const needsTypescript6ForVitePlusCore = (packageJson) =>
	packageJson.name === "@voidzero-dev/vite-plus-core" &&
	packageJson.version?.startsWith("0.2.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

// TypeScript ESLint v8 reads compiler internals that changed in TypeScript 7.
// Remove this once the TypeScript ESLint stack supports TypeScript 7.
const TYPESCRIPT_ESLINT_PACKAGES = new Set([
	"typescript-eslint",
	"@typescript-eslint/eslint-plugin",
	"@typescript-eslint/parser",
	"@typescript-eslint/project-service",
	"@typescript-eslint/rule-tester",
	"@typescript-eslint/tsconfig-utils",
	"@typescript-eslint/type-utils",
	"@typescript-eslint/typescript-estree",
	"@typescript-eslint/utils",
])

const needsTypescript6ForTypescriptEslint = (packageJson) =>
	TYPESCRIPT_ESLINT_PACKAGES.has(packageJson.name) &&
	packageJson.version?.startsWith("8.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

export const hooks = {
	readPackage(packageJson) {
		if (packageJson.name === "atom.io" && packageJson.version === "0.50.0") {
			packageJson.peerDependencies = {
				...packageJson.peerDependencies,
				"@typescript-eslint/utils": ">=8.0.0",
			}
			packageJson.peerDependenciesMeta = {
				...packageJson.peerDependenciesMeta,
				"@typescript-eslint/utils": { optional: true },
			}
		}

		if (needsTypescript6ForVitePlusCore(packageJson)) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: TYPESCRIPT_FOR_VITE_PLUS_CORE,
			}
		}

		if (needsTypescript6ForTypescriptEslint(packageJson)) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8,
			}
		}

		return packageJson
	},
}
