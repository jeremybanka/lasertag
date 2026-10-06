# Lasertag marketing bible

This document defines how Lasertag presents itself: what it believes, whom it
serves, what it promises, and how it differs from other approaches to styling
component applications.

## The position

Lasertag is structural CSS for people (and robots) who know CSS, love CSS, and
want to keep using it in React and other JSX frameworks without surrendering
maintainability.

Tailwind makes styling manageable by moving visual decisions into markup.
Lasertag takes the rival approach: keep visual details in CSS, keep logical
structure in components, and use static analysis to prove that the two remain
aligned.

The category is **structural CSS**. The product promise is **CSS you can
maintain**.

The formal definition is: **Lasertag is a statically enforced subset of CSS
Modules.**

## The conviction

CSS is not the problem. Unbounded relationships between structure, selectors,
and visual details are the problem.

Component frameworks improved how applications organize behavior, but ordinary
CSS did not gain equivalent structural boundaries. Developers are left choosing
between global uncertainty, CSS-in-JS runtime machinery, or utility classes
mixed into their logical markup.

Lasertag gives CSS the same component-shaped boundaries as JSX. It lets the
browser remain the styling engine and makes the relationship between a
component and its stylesheet statically understandable.

## The formal model

Lasertag is a statically enforced subset of CSS Modules.

It does not introduce a new stylesheet language, runtime, module format, or
bundler contract. A Lasertag stylesheet is a CSS Module with additional
structural constraints that tooling can verify before the application runs.

This gives Lasertag a simple compatibility rule:

> Anything that supports CSS Modules can, by definition, support Lasertag.

Frameworks and build tools do not need a Lasertag-specific rendering
integration. They continue compiling and loading ordinary CSS Modules.
Lasertag's editor, CLI, lint, and CI tooling enforce the narrower authoring
contract alongside that existing pipeline.

"Subset" is important. Lasertag gains confidence by intentionally ruling out
valid CSS Module patterns that weaken structural guarantees—for example,
exporting several styling classes from one component module or relying on
selectors that cannot be related to the component's rendered tree. Every
Lasertag module remains a CSS Module; not every CSS Module is Lasertag.

The relationship should be communicated as:

```text
Lasertag ⊂ CSS Modules ⊂ CSS
```

This is the foundation of the no-lock-in story. Removing Lasertag's static
checks leaves ordinary CSS Modules, not a proprietary runtime or a migration
project.

## Why Lasertag

### Decouple visual details from logical structure

Components should communicate structure, behavior, and meaning. Stylesheets
should own color, spacing, typography, layout, and responsive behavior.

Lasertag keeps those concerns separate without making them strangers. A
component and its same-named CSS Module describe the same tree, so visual
details remain outside the JSX while their structural relationship stays
explicit and checkable.

### Combine creativity with official HTML semantics

Lasertag does not replace CSS with a constrained styling vocabulary. Authors
retain the full expressive power of the platform: selectors, nesting, custom
properties, media queries, cascade layers, modern color, and everything the
browser learns next.

At the same time, components are pushed toward semantic HTML and descriptive
custom elements. The result is expressive CSS attached to a legible document,
not an anonymous sea of wrappers.

### Lower the dimensionality of CSS

Most CSS becomes difficult when one rule can vary across too many independent
dimensions: arbitrary classes, distant ancestors, global state, source order,
specificity, and markup that can change without a corresponding stylesheet
change.

Lasertag reduces that problem space. A component owns one structural tree and
one matching stylesheet. Selectors describe paths through that tree. Fewer
unbounded relationships mean fewer possible interactions to hold in your head.

That makes styles easier to reason about and raises confidence in what a change
can affect.

### Find dead code and keep it dead

Lasertag can identify selectors that no longer correspond to rendered
structure. Dead CSS becomes a local, actionable diagnostic rather than an
archaeological judgment call.

The same analysis runs continuously in the editor and in CI, so stale selectors
are caught when structure changes instead of accumulating indefinitely.

## Who it is for: people (and robots)

"People (and robots)" is a statement about the future of software development,
not a novelty tagline. Lasertag assumes that humans and LLM coding agents will
increasingly share responsibility for maintaining the same codebases.

Both benefit from the same properties: explicit structure, local ownership,
small context boundaries, machine-checkable conventions, and diagnostics that
turn architectural intent into an actionable correction loop.

### People who love CSS

Tailwind is famously welcoming to developers who never learned CSS deeply, or
who simply do not enjoy writing it. Lasertag is for the other group: people who
know CSS, value its native capabilities, and have never found it maintainable at
scale alongside React.

### Nesting enjoyers

Sass and SCSS fans, Less CSS fans, Emotion users, and anyone who naturally reads
a stylesheet as a tree will recognize the model immediately. Lasertag makes
that tree correspond to the rendered component structure.

### CSS Modules enjoyers

Lasertag builds on CSS Modules rather than replacing them. It adds structural
conventions, static guarantees, editor tooling, and dead-code detection to a
workflow developers already understand.

Formally, Lasertag is a statically enforced subset of CSS Modules. Anything
that already supports CSS Modules has the necessary runtime and build-time
foundation to support Lasertag.

### Performance fiends

Lasertag has no styling runtime. The browser receives ordinary classes and
ordinary CSS. Styles are local to components, so the styling surface grows with
the component system instead of with every combination of utility decisions in
the markup.

### Simplicity connoisseurs

There is no runtime state manager for styles, no component wrapper API, and no
new styling language. Lasertag is conventions plus static analysis applied to
TypeScript, JSX, Astro, and CSS.

### Correctness enthusiasts

The component and stylesheet can be checked as a pair. Invalid structural
assumptions and dead selectors become diagnostics rather than latent bugs.

### Maintainers

Lasertag narrows the blast radius of CSS changes. A maintainer can locate the
component that owns a style, inspect the exact rendered structure it addresses,
and change it with high confidence.

### Vibe coders

Logical fixes should not require an LLM to ingest a wall of incidental styling
tokens. When visual information lives in a sibling stylesheet, an agent can
reason about component behavior from the component and load styling context
only when the task actually concerns presentation.

The same separation makes generated changes easier for humans to review.

### Robots that write software

Lasertag gives coding agents unusually legible constraints. The rendered tree
is explicit, visual details are isolated from logical code, component ownership
is local, and violations arrive as concrete diagnostics. An agent does not need
to infer an unwritten styling architecture from thousands of class tokens.

Strictness is an advantage here. A convention that merely feels obvious to its
human author is invisible to a model. A convention expressed through examples,
static analysis, and a zero-warning finish line can be discovered and followed.

### Inspect Element users

In other words: frontend developers.

Lasertag does not permit meaningless `<div>` elements in exported components.
Rendered trees use semantic HTML and descriptive custom elements instead. Tag
names are frequently unique across the codebase, turning the browser inspector
into a direct index of source concepts.

See `<app-header-bar>` in DevTools; search for `AppHeaderBar`; arrive at the
component and its stylesheet.

## The contrast with Tailwind

The useful contrast is not "classes versus no classes." Both systems ultimately
ship CSS. The difference is where the authoring model places visual knowledge
and how it controls complexity.

| Tailwind                                           | Lasertag                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Visual decisions live in markup                    | Visual decisions live in stylesheets                              |
| A utility vocabulary constrains choices            | The CSS platform remains the vocabulary                           |
| Reuse emerges through components and class recipes | Reuse emerges through components, selectors, and CSS abstractions |
| Markup carries styling context                     | Markup communicates structure and behavior                        |
| Tooling generates CSS from used utilities          | Tooling analyzes the relationship between JSX and CSS             |
| Confidence comes from local utility composition    | Confidence comes from local structural boundaries                 |

Tailwind asks, "What if we made CSS maintainable by authoring less CSS?"

Lasertag asks, "What if we made CSS maintainable?"

## Front-page proof: an agent learns the system

The following report came from an LLM coding agent after it used Lasertag while
restructuring a real component. Its first pass produced 21 warnings. Rather than
silencing the checker, it inferred the one-class-per-component convention,
studied Lasertag's examples, replaced styling classes with descriptive custom
elements, and reached a clean result.

> "lasertag taught me its convention the hard way. My first pass had 21 warnings
> — a module exposes only `css.class`, one per component. `css.stage`,
> `css.field`, `css.submit` are all illegitimate. Its own examples style
> internals with nested element and custom-element selectors
> (`> hello-world { … }`), so I restructured to `<form-field>`,
> `<form-actions>`, `<mark-canvas>`. Now: no dead CSS found. That's a genuinely
> invasive convention, exactly as advertised."

— An AI coding agent reporting on its own implementation, July 17, 2026

The [original screenshot](assets/agent-testimonial.jpg) is retained with the
marketing source material.

This is not a controlled benchmark, and it should not be presented as evidence
that every agent will succeed unaided. It is a high-value success indicator
because it demonstrates the exact product loop Lasertag is designed to create:

1. The agent made a plausible but structurally invalid first attempt.
2. Diagnostics exposed every mismatch instead of allowing ambiguity to ship.
3. Examples taught the agent the intended pattern.
4. The agent improved the document structure instead of bypassing the rule.
5. The checker supplied an objective completion condition: no dead CSS found.

For homepage use, preserve the tension and the result:

> "Lasertag taught me its convention the hard way. My first pass had 21
> warnings… Now: no dead CSS found. That's a genuinely invasive convention,
> exactly as advertised."

Attribute it as **an AI coding agent, after independently restructuring a real
component to satisfy Lasertag**. Do not imply a paid customer, a human speaker,
or a controlled study.

## The enemy

The enemy is not another framework or the people who enjoy it. The enemy is
styling uncertainty:

- markup where logical structure is obscured by visual implementation details;
- selectors whose reach no one can confidently describe;
- wrappers with no semantic or structural identity;
- dead rules retained because deleting them feels dangerous;
- runtime styling machinery solving problems static analysis can solve earlier;
- maintenance work that requires loading an application's entire visual history
  into one person's head.

Comparisons should be sharp about tradeoffs and generous toward developers.

## Message hierarchy

Use these messages in this order. Do not lead with implementation machinery.

1. **CSS you can maintain.**
2. **Built for people (and robots) who love CSS.**
3. **Keep visual details in CSS and logical structure in JSX.**
4. **Use the full web platform with component-scale confidence.**
5. **Know what every selector affects. Delete what nothing uses.**
6. **Ship ordinary static CSS with no styling runtime.**
7. **Run anywhere CSS Modules run.**

## Tagline territory

Primary:

> CSS you can maintain.

Supporting lines:

- Structural CSS for JSX.
- A statically enforced subset of CSS Modules.
- If it supports CSS Modules, it supports Lasertag.
- For people (and robots) who love CSS.
- Love CSS again, at component scale.
- Keep the cascade. Lose the uncertainty.
- Your components have structure. Your CSS should know it.
- Full-power CSS. Component-scale confidence.
- Static CSS. Structural guarantees.
- Stop putting visual decisions in logical markup.

Provocative campaign lines:

- What if we made CSS maintainable?
- For people who actually like CSS.
- Utility classes are not the only way out.
- Your HTML is not a stylesheet.
- Delete dead CSS without crossing your fingers.
- The opposite of an endless sea of divs.

## Voice

Lasertag sounds like an experienced frontend engineer who still believes in the
web platform.

It is:

- precise, opinionated, and technically literate;
- delighted by CSS rather than apologetic about it;
- skeptical of unnecessary runtime machinery;
- playful enough to make strong contrasts memorable;
- confident because claims are tied to inspectable behavior.

It is not:

- hostile toward developers who chose different tools;
- nostalgic for global stylesheets or pre-component architectures;
- vague about what static analysis can and cannot prove;
- impressed by complexity for its own sake;
- afraid to state that some conventions are intentionally strict.

Use concrete verbs: inspect, locate, trace, delete, prove, ship, nest, render.
Avoid empty category language such as "next-generation," "revolutionary," or
"best-in-class."

## Proof before promotion

Marketing should demonstrate each important claim.

| Claim                               | Proof to show                                         |
| ----------------------------------- | ----------------------------------------------------- |
| CSS stays separate from logic       | Paired TSX and CSS Module exhibits                    |
| Structure is statically understood  | A render story beside its diagnosed stylesheet        |
| Dead CSS is easy to remove          | An editor or CLI diagnostic deleting a stale selector |
| Changes have a narrow blast radius  | A component tree with matching nested selectors       |
| There is no styling runtime         | Compiled output and bundle comparison                 |
| CSS Module support is sufficient    | The same module built by representative frameworks    |
| DevTools leads back to source       | A semantic/custom-element tree and source search      |
| Growth is predictable               | A benchmark across increasing component counts        |
| Agents need less irrelevant context | A controlled logical-edit prompt comparison           |
| Agents can learn the conventions    | The 21-warning agent report and a reproducible trial  |

Do not turn an intuition into a numeric claim until the benchmark exists. "No
styling runtime" is currently demonstrable. Bundle growth and agent-context
claims need published methodology before they become headline statistics.

## Homepage narrative

The homepage should tell one compact story:

1. **CSS you can maintain.** Introduce structural CSS for JSX.
2. Show the same component as semantic TSX and nested CSS, side by side.
3. Change the component structure and show Lasertag identify the stale selector.
4. Contrast the authored result with utility-heavy markup without caricaturing
   the alternative.
5. Let the agent testimonial establish that strict static conventions help
   robots discover and repair architectural mistakes too.
6. Name the people (and robots) who will feel at home: CSS lovers, maintainers,
   performance fiends, correctness enthusiasts, Inspect Element users, and
   coding agents working alongside them.
7. End with installation and a path into the guide.

The logo and visual system can be playful. The product explanation must remain
concrete.

## Short-form boilerplate

### One sentence

Lasertag is zero-runtime structural CSS for people (and robots) who love CSS:
keep visual details in CSS, logical structure in components, and let static
analysis prove they still match. Formally, it is a statically enforced subset
of CSS Modules, so it can run anywhere CSS Modules run.

### Short paragraph

Lasertag makes CSS maintainable in component applications. Each component pairs
with a CSS Module that mirrors its rendered structure, giving authors the full
power of native CSS without mixing visual details into JSX. Static analysis
finds structural mistakes and dead selectors in the editor and CI, with no
styling runtime shipped to users—and gives humans and coding agents the same
clear, checkable definition of done. Because Lasertag is a subset of CSS
Modules, existing CSS Module pipelines require no new runtime integration.

### Rival framing

Tailwind makes styling manageable by moving visual decisions into markup.
Lasertag is the rival approach for people who love CSS: keep styling in CSS,
give it component-shaped boundaries, and make those boundaries statically
checkable.

## Open questions

- Is "structural CSS" the permanent category name or the bridge to a more
  immediately legible phrase?
- Should the primary campaign lead with love of CSS, separation of concerns, or
  dead-code confidence?
- Which Tailwind comparison can be demonstrated most fairly in the first public
  exhibit?
- What benchmark best substantiates linear or predictable stylesheet growth?
- How should Lasertag describe custom elements to developers who associate them
  only with Web Components?
- Which strict rule creates the strongest first "I want that" reaction: paired
  modules, mirrored selectors, multiword component tags, or no `<div>`?
