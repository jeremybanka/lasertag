#!/usr/bin/env node

import { cli, help, options, parseBooleanOption } from "comline"
import { z } from "zod/v4"

const lasertagOptionsSchema = z.object({
	fix: z.boolean().default(false),
	help: z.boolean().default(false),
})

type LasertagOptions = z.infer<typeof lasertagOptionsSchema>

export type LasertagCliMode = `fix` | `help` | `validate`

export type LasertagCliResult = {
	mode: LasertagCliMode
	options: LasertagOptions
}

export type LasertagCliIO = {
	error: (message: string, ...data: unknown[]) => void
	log: (message: string, ...data: unknown[]) => void
}

const lasertagCli = cli({
	cliName: `lasertag`,
	cliDescription: `Validate lasertag CSS modules against component render stories.`,
	discoverConfigPath: () => undefined,
	routeOptions: {
		"": options(
			`Validate component-owned CSS modules. Use --fix to remove dead CSS when implemented.`,
			lasertagOptionsSchema,
			{
				fix: {
					description: `remove dead CSS when implemented`,
					example: `--fix`,
					flag: `f`,
					parse: parseBooleanOption,
					required: false,
				},
				help: {
					description: `show this help text`,
					example: `--help`,
					flag: `h`,
					parse: parseBooleanOption,
					required: false,
				},
			},
		),
	},
})

function runValidateStub(io: LasertagCliIO) {
	io.log(`lasertag validate: render-story CSS validation is stubbed.`)
}

function runFixStub(io: LasertagCliIO) {
	io.log(`lasertag fix: dead CSS cleanup is stubbed.`)
}

export function runLasertagCli(
	args: string[] = process.argv,
	io: LasertagCliIO = console,
): LasertagCliResult {
	const parsed = lasertagCli(args)
	const { opts } = parsed.inputs

	if (opts.help) {
		io.log(help(lasertagCli.definition))
		return { mode: `help`, options: opts }
	}

	if (opts.fix) {
		runFixStub(io)
		return { mode: `fix`, options: opts }
	}

	runValidateStub(io)
	return { mode: `validate`, options: opts }
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		runLasertagCli()
	} catch (error) {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	}
}
