# Takua Integration Note

Hi! I recently integrated `takua` into a VSCode language server and liked the
logger shape a lot. The main thing that would make this integration a snap is a
pluggable output sink.

## Context

Language servers often run over stdio. In that mode, stdout is not a normal log
stream; it is the JSON-RPC protocol transport. Any direct `console.log(...)`
call from the server can corrupt the protocol stream and break the editor
connection.

VSCode language servers need logs to flow through the LSP connection instead:

```ts
connection.console.info("message")
connection.console.warn("message")
connection.console.error("message")
connection.console.debug("message")
```

Those methods send `window/logMessage` notifications to the client instead of
writing arbitrary bytes to stdout.

## Current Friction

Takua currently formats nicely, but the logger writes through the process
console internally. For an LSP, that meant we had to build an adapter that:

- subclasses `Logger`
- overrides the protected `log(...)` method
- routes messages to `connection.console`
- adds a `debug` level
- adds log-level filtering
- reimplements `makeChronicle(...)` so chronicle output also avoids raw
  `console.log(...)`

That worked, but it means an integration that should have been tiny became a
custom subclass with duplicated formatting and timing behavior.

## The Smallest Useful Change

Let `Logger` accept a sink/transport in its config, defaulting to the current
console behavior.

Something like:

```ts
export type LogSink = {
	debug?: (message: string) => void
	error: (message: string) => void
	info: (message: string) => void
	log?: (message: string) => void
	warn: (message: string) => void
}

export type LoggerConfig = {
	colorEnabled?: boolean
	sink?: LogSink
}
```

Then Takua could continue to format each line internally, but call the provided
sink instead of hard-coding `console.log(...)`.

Usage in an LSP would become:

```ts
import { Logger } from "takua"

const logger = new Logger({
	colorEnabled: false,
	sink: {
		debug: connection.console.debug,
		error: connection.console.error,
		info: connection.console.info,
		log: connection.console.log,
		warn: connection.console.warn,
	},
})
```

That would remove the need for subclassing entirely.

## Slightly Richer Option

If Takua wants to keep formatting and transport more separate, an even nicer
shape would be a structured record sink:

```ts
export type LogRecord = {
	level: "debug" | "error" | "info" | "warn"
	prefix: string
	message: number | string
	data?: unknown
	time?: Date
}

export type LoggerConfig = {
	colorEnabled?: boolean
	write?: (record: LogRecord, formatted: string) => void
}
```

That would let normal CLI consumers keep colored formatted output, while tools
like language servers, daemon processes, test harnesses, and hosted runtimes can
route logs safely to their own transport.

## Chronicle Requirement

The important part is that every output path uses the same sink. In particular,
`makeChronicle(...).logMarks()` should not contain any direct console writes,
including blank-line writes. If a consumer supplies a sink, chronicle output
should flow through that sink too.

## Why This Matters

With a sink option, Takua becomes easy to use in places where stdout is reserved
or unavailable:

- language servers
- JSON-RPC processes
- MCP servers
- worker runtimes
- test harnesses
- hosted environments with custom logging APIs

The current API is already close. The missing piece is just separating "format a
nice log line" from "write it to process console."
