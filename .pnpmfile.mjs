const TYPESCRIPT_FOR_VITE_PLUS_CORE = "6.0.3"

// Vite+ core's declaration bundler reads the TypeScript compiler API that
// TypeScript 7 no longer exposes from the package root. Remove this once Vite+
// supports TypeScript 7 for declaration generation.
const needsTypescript6 = (packageJson) =>
	packageJson.name === "@voidzero-dev/vite-plus-core" &&
	packageJson.version?.startsWith("0.2.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

export const hooks = {
	readPackage(packageJson) {
		if (needsTypescript6(packageJson)) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: TYPESCRIPT_FOR_VITE_PLUS_CORE,
			}
		}

		return packageJson
	},
}
