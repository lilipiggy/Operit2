# Workflow WebView editor

The registered screen is `src/ui/web.ts`: a single shared Compose WebView with
bundled React, Material UI and React Flow resources. Graph gestures, selection,
node forms and dialogs execute inside the browser. The main QJS runtime still
owns validation, persistence, scheduling and tool execution.

`WorkflowHost.request` forwards browser argument arrays to `workflow.web`.
This channel returns service results without a reverse progress IPC dependency.
Execution currently displays a busy state followed by the final logs; it does
not stream live node progress or expose cancellation during a running request.
`WorkflowHost.exportFile` writes exports through `Tools.Files.create`.

Edits are local until Save or Run. Returning to the list with unsaved edits
offers Save or Discard. Double-click a node to edit it; touch users can select
a node and press Edit selected node. Drag handles to connect nodes and click
an edge to edit its branch condition. Automatic fit never enlarges a node past
100%. The previous DSL editor remains as historical source/test coverage and
is not a registered UI route.

## Build and verification

This package pins pnpm 10.7.0 through `package.json`. Use Corepack and the
committed `pnpm-lock.yaml` for reproducible installs; `package-lock.json` is not
used.

From this directory:

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm run pack:toolpkg
corepack pnpm run test:web
```

The browser test uses installed Microsoft Edge headlessly and the actual
workflow service with an isolated in-memory database. No application data is
modified. The package sync tool invokes `pack:toolpkg` and copies
`dist/workflow.toolpkg`. The bundled page requires no CDN. Third-party license
notices are included in the archive.

From the repository root, `node --test tools/tests/workflow_ui.test.mjs` covers
the production SDK argument bridge, empty-run failure and service lock release.

## Previous DSL parity audit (historical)

Reference: assistance/app/src/main/java/com/ai/assistance/operit/ui/features/workflow.

| Kotlin source | Plugin implementation |
| --- | --- |
| WorkflowListScreen.kt | src/ui/screen.ts: outlined cards, execution strip, empty state, selection mode, speed dial, creation name/description |
| WorkflowDetailScreen.kt | src/ui/screen.ts: canvas editor, node/metadata dialogs, explicit confirm/cancel, execution/log actions |
| GridWorkflowCanvas.kt | src/ui/canvas.ts: 40dp grid/snap, 120×80 nodes, centered fit, zoom bounds, rectangle-edge connections, branch labels, reference edges |
| DraggableNodeCard.kt | White idle cards, tinted drag state, colored borders/type chips, description/status; long press opens actions |
| NodeActionMenu.kt, ConnectionMenu.kt | Node actions, outgoing/available connections, condition editing and deletion |
| ScheduleConfigDialog.kt | src/ui/forms.ts: separate schedule dialog with interval, timestamp and cron settings |

Flutter fixes are shared DSL capabilities, not workflow-specific native screens:
bounded Dialog content, wrapping Column sizing, combined drag/scale recognition,
and independent floating action buttons without shared Hero tags.

## Verification

- tsc --noEmit -p plugins/packages/external/workflow/tsconfig.json
- node --test tools/tests/workflow_ui.test.mjs
- From apps/flutter/app: fvm flutter test --no-pub test/toolpkg_dsl/toolpkg_ui_launcher_screen_test.dart

The script tests execute the packaged modules and production Compose bridge,
including cold IPC registration, blank creation, cancelled/confirmed edits,
connections and reopening saved graphs. Flutter tests cover dialog scrolling
and reachable actions at desktop, portrait and short landscape sizes, plus
drag-to-pinch gesture transitions.

## Remaining differences

This is not yet a pixel-perfect port. Canvas text is host-measured rather than
Compose Text, and execution indicators do not reproduce all Kotlin animations.
The template catalog includes notification, condition, web extraction, data
processing, logic and scheduled proactive-AI examples. Tool selection uses a
common-tool list and manual parameter fields, not the original complete tool
catalog UI. Schedule fields use milliseconds / textual timestamps rather than
the original unit and date/time selectors. Trigger availability follows the
cross-platform host event contracts; Android-specific scheduling guarantees
are not implied.
