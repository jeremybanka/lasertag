import {
	Logger as TakuaLogger,
	type LogLevel as TakuaLogLevel,
	type LogSink,
} from "takua"

export type LasertagLspLogLevel = `debug` | `error` | `info` | `off` | `warn`

export type LasertagLspLogSink = LogSink

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

export function logLevelFromEnvironment(
	environment = process.env,
): LasertagLspLogLevel {
	return normalizeLogLevel(environment.LASERTAG_LSP_LOG_LEVEL, `info`)
}

export class LasertagLspLogger extends TakuaLogger {
	private level: LasertagLspLogLevel

	public constructor(sink: LasertagLspLogSink, level: LasertagLspLogLevel) {
		super({ colorEnabled: false, sink })
		this.level = level
	}

	public getLevel(): LasertagLspLogLevel {
		return this.level
	}

	public setLevel(level: LasertagLspLogLevel): void {
		this.level = level
	}

	public debug(prefix: string, message: number | string, data?: unknown): void {
		if (!this.shouldLog(`debug`)) return

		this.sink.debug?.(this.formatDebug(prefix, message, data))
	}

	protected override log(
		level: TakuaLogLevel,
		prefix: string,
		message: number | string,
		data?: unknown,
	): void {
		if (!this.shouldLog(level)) return

		super.log(level, prefix, message, data)
	}

	protected override write(
		level: TakuaLogLevel | `log`,
		message: string,
	): void {
		const equivalentLevel = level === `log` ? `info` : level

		if (!this.shouldLog(equivalentLevel)) return

		super.write(level, message)
	}

	private shouldLog(level: Exclude<LasertagLspLogLevel, `off`>): boolean {
		if (this.level === `off`) return false

		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level]
	}

	private formatDebug(
		prefix: string,
		message: number | string,
		data?: unknown,
	): string {
		return data === undefined
			? `debug ${prefix} ${message}`
			: `debug ${prefix} ${message} ${JSON.stringify(data)}`
	}
}

export function createLasertagLspLogger(
	sink: LasertagLspLogSink,
	level: LasertagLspLogLevel = logLevelFromEnvironment(),
): LasertagLspLogger {
	return new LasertagLspLogger(sink, level)
}
