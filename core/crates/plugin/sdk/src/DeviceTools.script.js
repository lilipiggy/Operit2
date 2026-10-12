/** Creates independent explicit-device views over the canonical tool namespaces. */
Tools.device = __operitToolPkgApi.method().since("2.0.0", function(nodeId, options) {
    if (typeof nodeId !== "string" || !nodeId || nodeId.length > 256 || /[\s\x00-\x1f\x7f]/.test(nodeId)) {
        throw new TypeError("Tools.device requires an exact nonblank node ID");
    }
    if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) {
        throw new TypeError("Device options must be an object");
    }
    options = options || {};
    var timeoutMs = options.timeoutMs === undefined ? 120000 : options.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000) {
        throw new TypeError("Device timeoutMs must be an integer between 1 and 86400000");
    }
    var cancellations = [];
    var context = {nodeId: nodeId, options: {timeoutMs: timeoutMs, signal: options.signal, __deviceCancellations: cancellations}};
    function namespace(source) {
        var target = {};
        Object.defineProperty(target, "__operitDeviceContext", {value: context});
        Object.keys(source).forEach(function(key) {
            if (key === "device") return;
            var value = source[key];
            if (typeof value === "function") {
                target[key] = function() { return value.apply(target, arguments); };
            } else if (value && typeof value === "object") {
                target[key] = namespace(value);
            }
        });
        return target;
    }
    var target = namespace(__operitCanonicalTools);
    function port(name) {
        return {execute: function(interfaceInfo, args) {
            if (arguments.length > 2) return Promise.reject(new TypeError("Hardware calls take interfaceInfo and args; select the node with Tools.device"));
            return __operitDeviceToolCall(nodeId, "default", name,
                {interface_info: interfaceInfo, args: args === undefined ? {} : args}, context.options, "port");
        }};
    }
    target.Edge = port("edge_execute");
    target.Io = port("io_execute");
    target.call = function(name, params) {
        if (typeof name !== "string" || !name.trim()) return Promise.reject(new TypeError("Tool name is required"));
        return __operitDeviceToolCall(nodeId, "default", name, params, context.options);
    };
    target.cancel = function() {
        cancellations.slice().forEach(function(cancel) { cancel(); });
    };
    target.catalog = function() {
        return __operitDeviceToolCall(nodeId, "default", "__device_catalog", {}, context.options, "catalog");
    };
    return target;
}).build("Tools.device");
