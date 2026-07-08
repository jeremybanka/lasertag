import { inspect } from "node:util"

import {
	Logger as TakuaLogger,
	type Chronicle,
	type LogLevel as TakuaLogLevel,
} from "takua"
import type { RemoteConsole } from "vscode-languageserver/node"

export type LasertagLspLogLevel = `debug` | `error` | `info` | `off` | `warn`

export type LasertagLspLogSink = Pick<
	RemoteConsole,
	"debug" | "error" | "info" | "log" | "warn"
>

const LOG_LEVEL_PRIORITY: Record<
	Exclude<LasertagLspLogLevel, `off`>,
	number
> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
}

function normalizeLogLevel(
	level: string | undefined,
	fallback: LasertagLspLogLevel,
): LasertagLspLogLevel {
	switch (level) {
		case `debug`:
		case `error`:
		case `info`:
		case `off`:
		case `warn`:
			return level
		default:
			return fallback
	}
}

function formatData(data: unknown): string {
	if (data === undefined) return ``
	if (typeof data === `string`) return data

	return inspect(data, {
		breakLength: 160,
		colors: false,
		compact: true,
		depth: 8,
		sorted: true,
	})
}

export function logLevelFromEnvironment(
	environment = process.env,
): LasertagLspLogLevel {
	return normalizeLogLevel(environment.LASERTAG_LSP_LOG_LEVEL, `info`)
}

export class LasertagLspLogger extends TakuaLogger {
	private readonly sink: LasertagLspLogSink
	private level: LasertagLspLogLevel

	public constructor(sink: LasertagLspLogSink, level: LasertagLspLogLevel) {
		super({ colorEnabled: false })
		this.sink = sink
		this.level = level
	}

	public getLevel(): LasertagLspLogLevel {
		return this.level
	}

	public setLevel(level: LasertagLspLogLevel): void {
		this.level = level
	}

	public debug(prefix: string, message: number | string, data?: unknown): void {
		this.emit(`debug`, prefix, message, data)
	}

	public override makeChronicle({
		inline = false,
	}: { inline?: boolean } = {}): Chronicle {
		const markers: PerformanceMark[] = []
		const logs: Array<[event: string, duration: number]> = []
		const logMark = (event: string, duration: number): void => {
			const durationText = duration.toFixed(2)
			const space = Math.max(1, 80 - 2 - event.length - durationText.length)

			this.info(event, `.`.repeat(space), durationText)
		}
		const chronicle: Chronicle = {
			logMarks: () => {
				const firstMarker = markers[0]
				const lastMarker = markers.at(-1)

				if (!firstMarker || !lastMarker) return

				const overall = performance.measure(
					`overall`,
					firstMarker.name,
					lastMarker.name,
				)

				if (!inline) {
					for (const [event, duration] of logs) logMark(event, duration)
				}

				logMark(`TOTAL TIME`, overall.duration)
				this.chronicle = undefined
			},
			mark: (text: string) => {
				const previousMarker = markers.at(-1)
				const nextMarker = performance.mark(text)

				if (previousMarker) {
					const metric = performance.measure(
						`${previousMarker.name} -> ${nextMarker.name}`,
						previousMarker.name,
						nextMarker.name,
					)

					if (inline) {
						logMark(nextMarker.name, metric.duration)
					} else {
						logs.push([nextMarker.name, metric.duration])
					}
				}

				markers.push(nextMarker)
			},
		}

		this.chronicle = chronicle

		return chronicle
	}

	protected override log(
		level: TakuaLogLevel,
		prefix: string,
		message: number | string,
		data?: unknown,
	): void {
		this.emit(level, prefix, message, data)
	}

	private shouldLog(level: Exclude<LasertagLspLogLevel, `off`>): boolean {
		if (this.level === `off`) return false

		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level]
	}

	private emit(
		level: Exclude<LasertagLspLogLevel, `off`>,
		prefix: string,
		message: number | string,
		data?: unknown,
	): void {
		if (!this.shouldLog(level)) return

		const timestamp = new Date().toISOString()
		const dataText = formatData(data)
		const line = dataText
			? `${timestamp} ${prefix} ${message} ${dataText}`
			: `${timestamp} ${prefix} ${message}`

		if (level === `debug`) {
			this.sink.debug(line)
			return
		}

		this.sink[level](line)
	}
}

export function createLasertagLspLogger(
	sink: LasertagLspLogSink,
	level: LasertagLspLogLevel = logLevelFromEnvironment(),
): LasertagLspLogger {
	return new LasertagLspLogger(sink, level)
}
