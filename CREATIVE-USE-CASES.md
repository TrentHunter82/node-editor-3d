# Rosebud — Creative Use Cases & Product Directions

A grounded brainstorm of what this 3D node editor is genuinely good for, tied to
the node types and features that actually ship today. Every "recipe" below uses
real node-type names from `src/types/index.ts`. Where a use case needs something
the tool doesn't have yet, it's called out under **Gap** with a pointer to
[Enhancements that unlock more](#enhancements-that-unlock-more).

---

## What the tool actually is (capability inventory)

A **frontend-only visual dataflow editor** rendered in a 3D workspace. You wire
~86 node types into a graph that executes topologically (in a Web Worker, with
caching, profiling, breakpoints, and timeouts). State persists locally in
IndexedDB. The palette, by category:

- **Core** — `source`, `transform`, `filter`, `output`
- **Math** — arithmetic (`math`), `clamp`, `remap`, `lerp`, full trig
  (`sin`/`cos`/`tan`), `abs`/`floor`/`ceil`/`round`/`log`/`sqrt`, and stats
  (`mean`, `median`, `stddev`, `min-array`, `max-array`)
- **Vector** — `compose-vec3`/`decompose-vec3`, `dot-product`, `cross-product`,
  `normalize-vec3`, `vec3-length`
- **String** — `template`/`string-template`, `concat`/`string-concat`,
  `string-replace`, `string-split`, `string-case`, `string-includes`,
  `string-length`, `string-trim`, `parse-number`
- **Logic** — `compare`, `switch`, `select`, `if-gate`, `and`/`or`/`not`/`xor`
- **Data** — arrays (`create-array`, `get`/`set-element`, `array-push`/`-filter`/
  `-map`/`-reduce`/`-slice`/`-find`/`-sort`/`-reverse`/`-flatten`/`-zip`/
  `-unique`/`-length`), objects (`create-object`, `get`/`set-property`,
  `object-keys`/`-values`, `merge-objects`), `json-parse`/`json-stringify`,
  `base64`/`uri` encode/decode, and **variables** (`get-var`/`set-var`)
- **Color** — `color-picker`, `color-mix`, `hsl-to-rgb`, `rgb-to-hsl`
- **Live** — `timer` (emits `Date.now() % interval`), `http-fetch` (GET a URL →
  parsed JSON/text + status + error). Both bypass the execution cache, and
  **Live Mode** (toggle in the execute bar) re-runs the graph on an interval so
  they update hands-free.
- **Date/Time** — `get-timestamp`, `format-date`, `parse-date`
- **Utility / structure** — `note`, `reroute`, `random`, `display`, **groups**,
  **subgraphs** (`subgraph` + `subgraph-input`/`-output`), and **custom nodes**
  (a JS-expression node you define inline)

Surrounding features that matter for real use: **auto-execute** on edit,
**templates**, **checkpoints** + a **timeline**, **undo history**, **macro
recording**, **graph diff/metrics**, **profiling heatmap**, a **minimap**, a
command/search palette, keyboard-driven everything, and **SVG export of the graph
diagram** (great for documentation, not a render of computed output).

### The differentiators (why reach for *this* over a script or a 2D tool)

1. **Spatial.** The graph lives in 3D — you orbit, group, and elevate nodes.
   Layout itself becomes meaning (a memory-palace for logic).
2. **Live data, no backend.** `http-fetch` + `json-parse` + the Data nodes make
   it an API mashup surface that deploys as a static site.
3. **Legible & auditable.** Every intermediate value is visible on-node; the
   profiling heatmap and breakpoints make the *flow* the documentation.
4. **Reusable.** Subgraphs, templates, and custom expression nodes let you build
   a personal library of "recipes."

---

## Use cases

### 1. Glanceable live dashboards / data walls
Poll a few endpoints and arrange them spatially as a dashboard you orbit through.

> `timer` → `http-fetch(url, trigger)` → `json-parse` → `get-property` →
> `string-template` → `display`

Build one cluster per source (crypto price, weather, GitHub stars, CI status,
on-call rota) and **group** + label each. Status/error outputs of `http-fetch`
drive a `compare` → `select` to show a red/green health glyph. Flip on **Live
Mode** and it refreshes hands-free.

### 2. No-code API mashups & ETL recipes
Visual extract-transform-load without writing a script — and you can *see* every
stage's data.

> two `http-fetch` → `json-parse` → `array-map`/`array-filter`/`array-reduce` →
> `merge-objects` → `json-stringify` → `output`

Wrap the transform half in a **subgraph** ("normalize record") and reuse it.
Save the whole thing as a **template** ("join + dedupe two feeds").

### 3. Interactive calculators & configurators
Mortgage/loan amortization, unit/currency converters, tip splitters, pricing
configurators, dosage calculators, "which plan should I pick" decision trees.

> `source` inputs → `math`/`remap`/`clamp` → `compare` → `switch`/`select` →
> `string-template` → `display`

Because it persists and exports, a finished calculator is a shareable artifact.
**Gap:** "publish as a clean input/output mini-app" — see Enhancements.

### 4. Teaching dataflow, functions, math & vectors
This is a *strong* fit. The 3D canvas + live values + profiling heatmap +
breakpoints make abstract ideas concrete for a classroom or self-learner.

- Functions & composition → **subgraphs** with named `subgraph-input`/`-output`.
- Trigonometry → `sin`/`cos` driving values you watch update.
- Vectors → `dot-product`/`cross-product`/`normalize-vec3` with live readouts.
- Statistics → feed `random` into `mean`/`median`/`stddev` and discuss.
- "What is referential transparency?" → toggle the execution **cache** and watch.

### 5. Generative & parametric design (palettes, design tokens)
Drive color and number systems procedurally.

> `color-picker` → `rgb-to-hsl` → `math`(rotate hue) → `hsl-to-rgb` → swatch
> `display`; or `source`(steps) → `lerp`/`remap` → tonal scale

Emit the result as design tokens via `create-object` → `json-stringify` →
`output`. Document the *generator* itself by **exporting the graph to SVG**.

### 6. Procedural content for games & creative tools
Loot tables, stat curves, dice-probability explainers, name generators.

> `random` → `remap`/`clamp` → stat curve; `create-array`(names) +
> `get-element`(random index) → `string-concat` → generated name;
> `random`×N → `mean`/`stddev` → distribution readout

Export configs as JSON; keep variant generators as templates.

### 7. A visual API playground ("3D Postman")
Compose requests and inspect responses spatially.

> `string-template`/`uri-encode` to build the URL → `http-fetch` →
> `object-keys`/`get-property` to drill into the JSON → `display`

Keep a wall of saved requests per service; `base64-encode` for simple auth
headers in the URL where APIs allow it.

### 8. Spatial mind-maps & system diagrams you walk through
Use `note`, `reroute`, **groups**, and node elevation to build living diagrams —
architecture maps, story outlines, dependency webs — then **export to SVG** to
share. The 3D layout doubles as a memory aid.

### 9. Modeling & simulation sandboxes
Compound interest, population/epidemic toy models, break-even analysis,
unit-economics what-ifs.

> `source`(params) → `math`/`log`/`sqrt` chains → `array-reduce` to accumulate →
> `display`; use `set-var`/`get-var` to carry named quantities across the graph

Pair with **checkpoints** to snapshot scenarios and the **timeline** to compare.

### 10. Live generative visuals / a "patch" surface
In the spirit of Max/MSP, Pure Data, or TouchDesigner — but in 3D.

> `timer` → `sin`/`cos` oscillators → `remap` → `color-mix`/`hsl-to-rgb` → driven
> swatches and numeric readouts

Turn on **Live Mode** for continuous animation. Driving *external* visuals/audio
still needs an output bridge (see Enhancements).

### 11. Auditable data-transformation recipes for analysts
For people who distrust black-box scripts: every step is visible, **diffable**
(graph diff), **profilable**, and **checkpointed**. Build a reviewable
"clean this messy JSON" or "reshape this record" pipeline with the Data nodes and
hand it to a colleague as a template.

### 12. Onboarding & live docs for the Latent Underground ecosystem
Because it's part of a larger ecosystem, ship explorable, *executing* diagrams of
"how our data flows" — real `http-fetch` calls against real endpoints, annotated
with `note` nodes, exported to SVG for the docs site.

---

## Killer-demo shortlist (highest wow-per-minute)

1. **Live crypto/weather wall** — one screen, three `http-fetch` clusters, orbit
   to read. Sells "live data, no backend" instantly. (Needs Live Mode to shine.)
2. **Mortgage/loan calculator** — relatable, self-contained, shows logic +
   string formatting + persistence in one graph.
3. **Trig playground** — `sin`/`cos` → values, with the profiling heatmap on.
   The clearest "this teaches" demo.
4. **Palette generator → JSON tokens** — visual *and* produces a real artifact.
5. **Two-API join** — the "no-code ETL" story, wrapped as a reusable subgraph.

---

## Enhancements that unlock more

Concrete, mostly on-theme additions that would convert several "Gap" notes above
into first-class use cases. Roughly ordered by leverage:

1. **Live Mode** — ✅ *Shipped.* A toggle in the execute bar re-executes the
   graph on a configurable interval (100 ms–60 s, default 1 s), skipping ticks
   while a run is still in flight. Unlocks real-time dashboards (#1), the API
   wall, and generative animation (#10). Settings → Execution sets the interval.
2. **Copy/export a node's computed output** — "copy value as JSON/CSV" from any
   node. Today SVG export covers the *diagram*; this covers the *result*, making
   calculators and ETL recipes deliver tangible output.
3. **Presentation / "mini-app" view** — hide the wiring and surface only `source`
   inputs + `display` outputs, so a finished graph reads as a clean tool. Turns
   #3 calculators and #9 sandboxes into shareable apps.
4. **Output bridges for Live visuals** — e.g. drive a canvas/CSS variable or emit
   MIDI/OSC/WebSocket, so #10 can control real visuals/audio.
5. **`http-fetch` ergonomics** — method/headers/body inputs, and an in-app note
   about browser **CORS** limits (frontend-only fetch only reaches CORS-friendly
   endpoints). Worth surfacing so #2/#7 don't surprise users.
6. **CSV in/out nodes** — `csv-parse`/`csv-stringify` would make #11 land with the
   analyst audience that lives in spreadsheets.

> Note on accuracy: the tool is **frontend-only**. `http-fetch` is a browser GET
> subject to CORS; there is no continuous execution loop today (the graph runs on
> manual Run or debounced auto-execute on edit). The brainstorm above reflects
> that, and the Gaps point at the smallest changes that remove the limitation.
