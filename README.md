# Rosebud — 3D Node Editor

A fully-featured visual node editor rendered in 3D using React Three Fiber. Build data-flow graphs by connecting nodes on a 3D workspace with orbital camera controls, real-time execution, and a tactile hardware-inspired aesthetic.

![Node Editor 3D](public/og-preview.png)

## Features

- **3D workspace** — Orbit, pan, and zoom through your node graph in full 3D with perspective camera
- **86+ built-in node types** — Math, string, logic, vector, color, data structures, timers, HTTP fetch, and more
- **Real-time execution** — Data flows through the graph live with visual feedback (running/complete/error states)
- **Custom nodes** — Write arbitrary JavaScript expressions with variable inputs
- **Subgraphs** — Nest graphs inside nodes for hierarchical composition
- **Breakpoints & debugging** — Step through execution, inspect values, conditional breakpoints
- **Undo/redo** — Full history with checkpoint system
- **Copy/paste & duplicate** — With intelligent connection remapping
- **Keyboard-driven** — 50+ shortcuts for editing, navigation, and panels
- **Search & replace** — Find nodes by name, type, or data values
- **Auto-layout** — One-key graph arrangement
- **Minimap** — Bird's-eye navigation overlay
- **Node screens** — CRT-styled inline parameter editors on each node's top face
- **Inline value overlays** — See live values without opening screens
- **Execution heatmap** — Color-code nodes by relative execution time
- **Data-flow tracing** — Highlight upstream/downstream paths from any node
- **Graph diffing** — Visual comparison between graph snapshots
- **Profiling panel** — Per-node timing metrics with aggregation
- **Validation** — Real-time error detection with visual indicators
- **Node locking** — Prevent accidental edits with visual lock indicator
- **Snap-to-grid** — Configurable grid with visual alignment guides
- **Graph tabs** — Multiple graphs open simultaneously
- **SVG export** — Export graph diagrams
- **IndexedDB persistence** — Auto-save with checkpoint/restore
- **Dark & light themes**
- **Accessibility** — Keyboard navigation, screen reader announcements, ARIA labels
- **LOD rendering** — Distant nodes render as simplified imposters for performance

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 19 |
| 3D Engine | Three.js 0.182 |
| React Renderer | React Three Fiber 9.5 |
| 3D Utilities | Drei 10.7 |
| Post-Processing | R3F Postprocessing 3.0 (Bloom, Vignette) |
| Animations | React Spring Three |
| State Management | Zustand 5 + Immer |
| Persistence | IndexedDB (idb) |
| Build Tool | Vite 7 |
| Language | TypeScript 5.9 |
| Testing | Vitest 4 + Testing Library |

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Node Types

| Category | Types |
|----------|-------|
| **Core** | Source, Transform, Filter, Output, Display |
| **Math** | Add/Sub/Mul/Div, Clamp, Remap, Lerp, Trig (sin/cos/tan), Abs, Floor/Ceil/Round, Log, Sqrt, Mean, Median, StdDev |
| **String** | Concat, Template, Length, Trim, Split, Case, Replace, Includes, Parse Number |
| **Logic** | Compare, Switch, AND/OR/NOT/XOR, If-Gate, Select |
| **Vector** | Compose/Decompose Vec3, Dot/Cross Product, Normalize, Length |
| **Data** | Array ops (create, get, set, push, filter, map, reduce, slice, sort, reverse, flatten, zip, unique), Object ops (create, get, set, keys, values, merge), JSON parse/stringify, Base64, URI encode/decode, Variables |
| **Color** | Color Picker, Color Mix, HSL/RGB conversion |
| **Utility** | Note, Reroute, Random, Timestamp, Date format/parse, Custom expression |
| **Live** | Timer (interval), HTTP Fetch |
| **Subgraph** | Subgraph, Subgraph Input, Subgraph Output |

## Keyboard Shortcuts

<details>
<summary>Selection & Navigation</summary>

| Key | Action |
|-----|--------|
| `Escape` | Cancel / Deselect |
| `Ctrl+A` | Select All |
| `Tab` / `Shift+Tab` | Cycle nodes/ports |
| `F` | Zoom to Fit |
| `Ctrl+0` | Reset Camera |
| `+` / `-` | Zoom In / Out |
| `Shift+U` | Select Upstream |
| `Shift+D` | Select Downstream |
| `Shift+B` | Select Connected |
| `Shift+O` | Toggle Overview Mode |

</details>

<details>
<summary>Editing</summary>

| Key | Action |
|-----|--------|
| `Delete` | Delete Selected |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste |
| `Ctrl+D` | Duplicate |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
| `H` | Toggle Collapse |
| `Shift+L` | Toggle Lock |
| `L` | Auto Layout |
| `G` / `Shift+G` | Toggle Snap / Grid |
| `N` | Add Note |
| `V` | Toggle Value Previews |

</details>

<details>
<summary>Panels & Execution</summary>

| Key | Action |
|-----|--------|
| `Ctrl+K` | Command Palette |
| `Ctrl+H` | Find & Replace |
| `Shift+I` | Inspector |
| `Shift+M` | Minimap |
| `Shift+P` | Profiling |
| `T` | Toolbar |
| `Ctrl+Shift+E` | Execute Selection |
| `F9` | Toggle Breakpoint |
| `F10` | Debug Step |
| `F5` | Debug Resume |

</details>

## Project Structure

```
src/
  components/
    nodes/       # Node rendering (NodeModule, NodeScreen, Port, etc.)
    ui/          # Panels, toolbar, menus, dialogs
  store/
    slices/      # Zustand store slices (nodes, connections, execution, etc.)
  hooks/         # Custom React hooks
  types/         # TypeScript type definitions
  utils/         # Utilities (execution engine, layout, serialization, etc.)
  styles/        # Global CSS
```

## Testing

238 test files covering unit, integration, performance, and regression scenarios.

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

## License

MIT
