import { Hono } from "hono"

import { ProjectCard } from "./ProjectCard.js"

const app = new Hono()

app.get(`/`, (c) =>
	c.html(
		<html lang="en">
			<head>
				<title>Project reports</title>
				<link rel="stylesheet" href="/assets/app.css" />
			</head>
			<body>
				<ProjectCard name="Example project" reports={[`main`]} />
			</body>
		</html>,
	),
)

// The host supplies HTMX and serves the CSS Module build output at /assets/app.css.
app.get(`/project`, (c) =>
	c.html(<ProjectCard name="Example project" reports={[`main`, `feature`]} />),
)

export default app
