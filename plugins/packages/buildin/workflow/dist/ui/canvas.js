"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapPosition = snapPosition;
exports.fitViewport = fitViewport;
exports.hitNode = hitNode;
exports.edgePoints = edgePoints;
exports.graphCanvas = graphCanvas;
const model_1 = require("../model");
const engine_1 = require("../engine");
/** Snaps node coordinates to the original 40dp grid. */
function snapPosition(x, y) {
    return { x: Math.round(x / 40) * 40, y: Math.round(y / 40) * 40 };
}
/** Centers measured graph bounds with 48dp padding and the Kotlin zoom limits. */
function fitViewport(workflow, viewport) {
    if (!workflow.nodes.length || viewport.width <= 0 || viewport.height <= 0)
        return viewport;
    const left = Math.min(...workflow.nodes.map(node => node.position.x));
    const top = Math.min(...workflow.nodes.map(node => node.position.y));
    const right = Math.max(...workflow.nodes.map(node => node.position.x + 120));
    const bottom = Math.max(...workflow.nodes.map(node => node.position.y + 80));
    const zoom = Math.max(0.25, Math.min(3, (viewport.width - 96) / (right - left), (viewport.height - 96) / (bottom - top)));
    return { ...viewport, zoom, x: viewport.width / 2 - (left + right) / 2 * zoom, y: viewport.height / 2 - (top + bottom) / 2 * zoom };
}
/** Finds the topmost node in logical graph coordinates. */
function hitNode(workflow, x, y) {
    for (let i = workflow.nodes.length - 1; i >= 0; i--) {
        const node = workflow.nodes[i];
        if (x >= node.position.x && x <= node.position.x + 120 && y >= node.position.y && y <= node.position.y + 80)
            return node.id;
    }
    return null;
}
/** Intersects the center-to-center direction with the two node boundaries. */
function edgePoints(a, b) {
    const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    if (dx === 0 && dy === 0)
        return [];
    const fraction = Math.min(dx === 0 ? Infinity : 60 / Math.abs(dx), dy === 0 ? Infinity : 40 / Math.abs(dy));
    return [
        { x: a.position.x + 60 + dx * fraction, y: a.position.y + 40 + dy * fraction },
        { x: b.position.x + 60 - dx * fraction, y: b.position.y + 40 - dy * fraction },
    ];
}
/** Produces shared sampled Bezier geometry for drawing and selecting an edge. */
function curve(ax, ay, bx, by) {
    const span = Math.hypot(bx - ax, by - ay) * 0.4;
    return Array.from({ length: 65 }, (_, index) => {
        const t = index / 64, u = 1 - t;
        return { x: u ** 3 * ax + 3 * u ** 2 * t * (ax + span) + 3 * u * t ** 2 * (bx - span) + t ** 3 * bx,
            y: u ** 3 * ay + 3 * u ** 2 * t * ay + 3 * u * t ** 2 * by + t ** 3 * by };
    });
}
/** Builds the grid, colored nodes, branch labels and interaction layer. */
function graphCanvas(ctx, workflow, actions) {
    const v = actions.viewport;
    const commands = [];
    /** Converts graph-space horizontal coordinates into canvas-space positions. */
    const sx = (x) => v.x + x * v.zoom;
    /** Converts graph-space vertical coordinates into canvas-space positions. */
    const sy = (y) => v.y + y * v.zoom;
    /** Centers bounded node labels using host text measurement. */
    function centered(text, x, y, fontSize, maxWidth, color, maxLines = 1) {
        const measured = ctx.measureText({ text, fontSize, maxWidth, maxLines, overflow: "ellipsis" });
        commands.push({ type: "Text", text, x: x - measured.width / 2, y, fontSize, maxWidth, maxLines, color, overflow: "ellipsis" });
    }
    /** Draws a filled arrow oriented along the sampled curve. */
    function arrow(a, b, color) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x), size = 9 * v.zoom;
        commands.push({ type: "DrawPath", color, style: "fill", path: [
                { type: "MoveTo", x: b.x, y: b.y },
                { type: "LineTo", x: b.x - size * Math.cos(angle - Math.PI / 6), y: b.y - size * Math.sin(angle - Math.PI / 6) },
                { type: "LineTo", x: b.x - size * Math.cos(angle + Math.PI / 6), y: b.y - size * Math.sin(angle + Math.PI / 6) },
                { type: "Close" },
            ] });
    }
    /** Paints boundary-anchored execution and parameter-reference edges. */
    function drawEdge(a, b, color, dashed, label, reference = false) {
        const ends = edgePoints(a, b);
        if (!ends.length)
            return;
        const points = curve(sx(ends[0].x), sy(ends[0].y), sx(ends[1].x), sy(ends[1].y));
        let length = 0;
        for (let index = 1; index < points.length; index++) {
            const previous = points[index - 1], point = points[index];
            length += Math.hypot(point.x - previous.x, point.y - previous.y);
            if (!dashed || length % (12 * v.zoom) < 7 * v.zoom)
                commands.push({ type: "Line", x1: previous.x, y1: previous.y, x2: point.x, y2: point.y, color, strokeWidth: 1.5 * v.zoom });
        }
        arrow(points[63], points[64], color);
        if (!reference)
            arrow(points[31], points[32], color);
        if (label !== null) {
            const middle = points[32], size = ctx.measureText({ text: label, fontSize: 11 * v.zoom, maxWidth: 120 * v.zoom, maxLines: 1 });
            commands.push({ type: "RoundRect", x: middle.x - size.width / 2 - 5 * v.zoom, y: middle.y - 11 * v.zoom,
                width: size.width + 10 * v.zoom, height: 22 * v.zoom, radius: 4 * v.zoom, color: "#EEFFFFFF", filled: true });
            centered(label, middle.x, middle.y - 7 * v.zoom, 11 * v.zoom, 120 * v.zoom, color);
        }
    }
    const grid = 40 * v.zoom;
    for (let x = ((v.x % grid) + grid) % grid; x < v.width; x += grid)
        for (let y = ((v.y % grid) + grid) % grid; y < v.height; y += grid) {
            commands.push({ type: "Circle", cx: x, cy: y, radius: 1.5 * v.zoom, color: "#888888", filled: true });
        }
    for (const target of workflow.nodes) {
        const references = new Set((0, model_1.values)(target).flatMap(value => "nodeId" in value ? [value.nodeId] : []));
        for (const sourceId of references)
            drawEdge(workflow.nodes.find(node => node.id === sourceId), target, "#BFFF9800", true, null, true);
    }
    for (const edge of workflow.connections) {
        const a = workflow.nodes.find(node => node.id === edge.sourceNodeId);
        const b = workflow.nodes.find(node => node.id === edge.targetNodeId);
        const sourceResult = actions.run === null ? undefined : actions.run.nodes[a.id];
        const targetResult = actions.run === null ? undefined : actions.run.nodes[b.id];
        const active = sourceResult !== undefined && targetResult !== undefined && targetResult.status !== "skipped" && (0, engine_1.edgeMatches)(edge, a, sourceResult);
        const color = actions.run === null ? "#4285F4" : !active ? "#BDBDBD" : targetResult.status === "running" ? "#2196F3" : targetResult.status === "failed" ? "#F44336" : "#4CAF50";
        const condition = edge.condition === null ? "" : edge.condition.trim();
        const label = condition === "" ? (a.type === "condition" || a.type === "logic" ? "T" : null)
            : condition.toLowerCase() === "true" ? "T" : condition.toLowerCase() === "false" ? "F" : "R:" + (condition.length > 12 ? condition.slice(0, 12) + "…" : condition);
        drawEdge(a, b, color, actions.run !== null && !active, label);
    }
    for (const node of workflow.nodes) {
        const style = model_1.STYLES[node.type];
        const x = sx(node.position.x), y = sy(node.position.y), width = 120 * v.zoom, height = 80 * v.zoom;
        const result = actions.run === null ? undefined : actions.run.nodes[node.id];
        let border = actions.dragging === node.id ? style.color : style.border;
        if (result)
            border = { pending: border, running: "#2196F3", success: "#4CAF50", failed: "#F44336", skipped: "#9E9E9E" }[result.status];
        commands.push({ type: "RoundRect", x, y: y + 2 * v.zoom, width, height, radius: 8 * v.zoom, color: "#20000000", filled: true }, { type: "RoundRect", x, y, width, height, radius: 8 * v.zoom, color: actions.dragging === node.id ? style.tint : "#FFFFFF", filled: true }, { type: "RoundRect", x, y, width, height, radius: 8 * v.zoom, color: border, filled: false, strokeWidth: (result ? 3 : 2) * v.zoom }, { type: "RoundRect", x: x + 7 * v.zoom, y: y + 6 * v.zoom, width: width - 14 * v.zoom, height: 17 * v.zoom, radius: 4, color: style.tint, filled: true }, { type: "DrawIcon", icon: node.type === "trigger" ? "PlayArrow" : "Settings", x: x + 40 * v.zoom, y: y + 9 * v.zoom, size: 12 * v.zoom, color: style.color });
        centered(style.label, x + 66 * v.zoom, y + 7 * v.zoom, 10 * v.zoom, 44 * v.zoom, style.color);
        centered(node.name, x + width / 2, y + 28 * v.zoom, 13 * v.zoom, width - 16 * v.zoom, "#212121", 2);
        if (result)
            centered({ pending: "等待", running: "执行中", success: "成功", failed: "失败", skipped: "跳过" }[result.status], x + width / 2, y + 63 * v.zoom, 9 * v.zoom, width - 16 * v.zoom, border);
        else if (node.description)
            centered(node.description, x + width / 2, y + 63 * v.zoom, 9 * v.zoom, width - 16 * v.zoom, "#757575");
    }
    return ctx.UI.Canvas({ key: "workflow-canvas", fillMaxSize: true, background: "#F8F9FA",
        commands, onSizeChanged: size => actions.resize(size.width, size.height),
        modifier: ctx.Modifier.fillMaxSize().clipToBounds()
            .tapGestures({ onDoubleTap: actions.fit, onLongPress: point => {
                const node = hitNode(workflow, (point.x - v.x) / v.zoom, (point.y - v.y) / v.zoom);
                if (node !== null)
                    actions.menu(node);
            } })
            .dragGestures({ onDragStart: point => actions.begin(hitNode(workflow, (point.x - v.x) / v.zoom, (point.y - v.y) / v.zoom)),
            onDrag: point => actions.drag(point.deltaX, point.deltaY), onDragEnd: actions.end, onDragCancel: actions.cancel })
            .transformGestures({ onGesture: event => {
                const zoom = Math.max(0.25, Math.min(3, v.zoom * event.zoom)), ratio = zoom / v.zoom;
                actions.transform(event.centroidX - (event.centroidX - event.panX - v.x) * ratio, event.centroidY - (event.centroidY - event.panY - v.y) * ratio, zoom);
            } }),
    });
}
