import { useMemo } from "react";
import {
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type {
  Comparison,
  ExtractMode,
  ToolDefinition,
  ToolParameterSchema,
  Value,
  Workflow,
  WorkflowNode,
} from "../../src/model";

const comparisonOptions: { value: Comparison; label: string }[] = [
  { value: "EQ", label: "=" },
  { value: "NE", label: "≠" },
  { value: "GT", label: ">" },
  { value: "GTE", label: "≥" },
  { value: "LT", label: "<" },
  { value: "LTE", label: "≤" },
  { value: "CONTAINS", label: "包含" },
  { value: "NOT_CONTAINS", label: "不包含" },
  { value: "IN", label: "属于" },
  { value: "NOT_IN", label: "不属于" },
];

const logicOptions = [
  { value: "AND", label: "且" },
  { value: "OR", label: "或" },
];

const extractModeOptions: { value: ExtractMode; label: string }[] = [
  { value: "REGEX", label: "正则提取" },
  { value: "JSON", label: "JSON 取值" },
  { value: "SUB", label: "截取文本" },
  { value: "CONCAT", label: "拼接文本" },
  { value: "RANDOM_INT", label: "随机整数" },
  { value: "RANDOM_STRING", label: "随机文本" },
];

const scheduleTypeOptions = [
  { value: "interval", label: "按间隔执行" },
  { value: "specific_time", label: "指定时间执行" },
  { value: "cron", label: "Cron 表达式" },
];

/** Edits literals and upstream references using the persisted parameter contract. */
function Parameter({
  label,
  value,
  nodes,
  change,
  schema,
}: {
  label: string;
  value: Value;
  nodes: WorkflowNode[];
  change(value: Value): void;
  schema?: ToolParameterSchema;
}) {
  const type = schema?.type.trim().toLowerCase() ?? "string";
  const booleanTypes = new Set(["bool", "boolean"]);
  const numericTypes = new Set(["int", "integer", "number", "float", "double"]);
  const jsonTypes = new Set(["array", "object", "json"]);
  const literalValue = "value" in value ? value.value : "";
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {label}
        {schema?.required ? " · 必填" : " · 可选"}
      </Typography>
      {schema?.description && (
        <Typography variant="caption" color="text.secondary">
          {schema.description}
        </Typography>
      )}
      <TextField
        select
        size="small"
        label="值来源"
        value={"value" in value ? "literal" : "reference"}
        onChange={(event) => {
          if (event.target.value === "literal") change({ value: "" });
          else if (nodes.length) change({ nodeId: nodes[0].id });
        }}
      >
        <MenuItem value="literal">固定值</MenuItem>
        <MenuItem value="reference" disabled={!nodes.length}>
          节点输出
        </MenuItem>
      </TextField>
      {"value" in value ? (
        booleanTypes.has(type) ? (
          <FormControlLabel
            label={literalValue === "true" ? "开启" : "关闭"}
            control={
              <Switch
                checked={literalValue === "true"}
                onChange={(_, checked) => change({ value: String(checked) })}
              />
            }
          />
        ) : (
          <TextField
            size="small"
            multiline={jsonTypes.has(type)}
            minRows={jsonTypes.has(type) ? 3 : undefined}
            label={label}
            type={numericTypes.has(type) ? "number" : "text"}
            value={literalValue}
            onChange={(event) => change({ value: event.target.value })}
            helperText={schema?.description || undefined}
          />
        )
      ) : (
        <TextField
          select
          size="small"
          label="来源节点"
          value={value.nodeId}
          onChange={(event) => change({ nodeId: event.target.value })}
        >
          {nodes.map((node) => (
            <MenuItem key={node.id} value={node.id}>
              {node.name}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  );
}

/** Edits every node kind without changing the execution schema. */
export function NodeForm({
  node,
  workflow,
  tools,
  change,
}: {
  node: WorkflowNode;
  workflow: Workflow;
  tools: ToolDefinition[];
  change(node: WorkflowNode): void;
}) {
  const sources = workflow.nodes.filter((item) => item.id !== node.id);
  const orderedTools = useMemo(
    () => [...tools].sort((left, right) => left.name.localeCompare(right.name)),
    [tools],
  );
  /** Updates a typed field on the current node draft. */
  function set(field: string, value: unknown) {
    change({ ...node, [field]: value } as WorkflowNode);
  }
  /** Builds a controlled text or integer input for one draft field. */
  function field(
    label: string,
    name: string,
    value: string | number,
    numeric = false,
  ) {
    return (
      <TextField
        key={name}
        size="small"
        label={label}
        type={numeric ? "number" : "text"}
        value={value}
        onChange={(event) =>
          set(name, numeric ? Number(event.target.value) : event.target.value)
        }
      />
    );
  }
  /** Builds an exact-choice selector for a draft field. */
  function select(
    label: string,
    name: string,
    value: string,
    options: { value: string; label: string }[],
  ) {
    return (
      <TextField
        select
        size="small"
        label={label}
        value={value}
        onChange={(event) => set(name, event.target.value)}
      >
        {options.map((item) => (
          <MenuItem key={item.value} value={item.value}>
            {item.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  /** Changes one schedule field while retaining the remaining configuration. */
  function config(name: string, value: string) {
    if (node.type === "trigger")
      change({
        ...node,
        triggerConfig: { ...node.triggerConfig, [name]: value },
      });
  }
  const selectedTool =
    node.type === "execute"
      ? orderedTools.find((tool) => tool.name === node.actionType)
      : undefined;
  /** Applies a selected tool schema and initializes its declared parameters. */
  function selectTool(actionType: string) {
    if (node.type !== "execute") return;
    const tool = orderedTools.find((item) => item.name === actionType);
    if (!tool) throw new Error(`工具元数据不存在：${actionType}`);
    const actionConfig = Object.fromEntries(
      tool.parameters.map((parameter) => [
        parameter.name,
        node.actionConfig[parameter.name] ?? {
          value: parameter.default ?? "",
        },
      ]),
    );
    change({ ...node, actionType, actionConfig });
  }
  return (
    <Stack spacing={2} sx={{ pt: 1 }}>
      {field("节点名称", "name", node.name)}
      {field("说明", "description", node.description)}
      {node.type === "trigger" && (
        <>
          <TextField
            select
            size="small"
            label="触发方式"
            value={node.triggerType}
            onChange={(event) => {
              const kind = event.target.value as typeof node.triggerType;
              change({
                ...node,
                triggerType: kind,
                triggerConfig:
                  kind === "schedule"
                    ? {
                        schedule_type: "interval",
                        interval_ms: "900000",
                        enabled: "true",
                        repeat: "true",
                      }
                    : kind === "event"
                      ? { topic: "app.lifecycle.resumed" }
                      : {},
              });
            }}
          >
            {Object.entries({
              manual: "手动",
              schedule: "定时",
              app_open: "应用启动",
              event: "宿主事件",
            }).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          {node.triggerType === "event" && (
            <TextField
              label="事件主题"
              size="small"
              value={node.triggerConfig.topic}
              onChange={(event) => config("topic", event.target.value)}
            />
          )}
          {node.triggerType === "schedule" && (
            <>
              <TextField
                select
                size="small"
                label="定时方式"
                value={node.triggerConfig.schedule_type}
                onChange={(event) =>
                  change({
                    ...node,
                    triggerConfig: {
                      enabled: "true",
                      repeat: "true",
                      schedule_type: event.target.value,
                      ...{
                        interval: { interval_ms: "900000" },
                        specific_time: { specific_time: "2026-12-31 12:00:00" },
                        cron: { cron_expression: "0 9 * * *" },
                      }[event.target.value],
                    },
                  })
                }
              >
                {scheduleTypeOptions.map((item) => (
                  <MenuItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuItem>
                ))}
              </TextField>
              {Object.entries(node.triggerConfig)
                .filter(
                  ([name]) =>
                    !["enabled", "repeat", "schedule_type"].includes(name),
                )
                .map(([name, value]) => (
                  <TextField
                    key={name}
                    size="small"
                    label={name}
                    value={value}
                    onChange={(event) => config(name, event.target.value)}
                  />
                ))}
              {["enabled", "repeat"].map((name) => (
                <FormControlLabel
                  key={name}
                  label={name === "enabled" ? "启用定时" : "重复"}
                  control={
                    <Switch
                      checked={node.triggerConfig[name] === "true"}
                      onChange={(_, checked) => config(name, String(checked))}
                    />
                  }
                />
              ))}
            </>
          )}
        </>
      )}
      {node.type === "execute" && (
        <>
          <TextField
            select
            size="small"
            label="执行工具"
            value={node.actionType}
            onChange={(event) => selectTool(event.target.value)}
            helperText={
              selectedTool
                ? `${selectedTool.source === "package" ? "工具包" : "内置工具"} · ${selectedTool.category}`
                : "请选择运行时提供的工具"
            }
          >
            {orderedTools.map((tool) => (
              <MenuItem key={tool.name} value={tool.name}>
                {tool.name}
              </MenuItem>
            ))}
          </TextField>
          {selectedTool?.description && (
            <Typography variant="body2" color="text.secondary">
              {selectedTool.description}
            </Typography>
          )}
          {selectedTool ? (
            selectedTool.parameters.length ? (
              selectedTool.parameters.map((schema) => (
                <Parameter
                  key={schema.name}
                  label={schema.name}
                  schema={schema}
                  value={
                    node.actionConfig[schema.name] ?? {
                      value: schema.default ?? "",
                    }
                  }
                  nodes={sources}
                  change={(next) =>
                    set("actionConfig", {
                      ...node.actionConfig,
                      [schema.name]: next,
                    })
                  }
                />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                此工具不需要参数
              </Typography>
            )
          ) : null}
          <FormControlLabel
            label="JavaScript 执行"
            control={
              <Switch
                checked={node.jsCode !== null}
                onChange={(_, checked) =>
                  set("jsCode", checked ? "return inputs;" : null)
                }
              />
            }
          />
          {node.jsCode !== null && (
            <TextField
              multiline
              minRows={6}
              label="脚本（inputs、trigger、Tools、toolCall）"
              value={node.jsCode}
              onChange={(event) => set("jsCode", event.target.value)}
            />
          )}
        </>
      )}
      {node.type === "condition" && (
        <>
          <Parameter
            label="左值"
            value={node.left}
            nodes={sources}
            change={(value) => set("left", value)}
          />
          {select("比较方式", "operator", node.operator, comparisonOptions)}
          <Parameter
            label="右值"
            value={node.right}
            nodes={sources}
            change={(value) => set("right", value)}
          />
        </>
      )}
      {node.type === "logic" &&
        select("逻辑运算", "operator", node.operator, logicOptions)}
      {node.type === "extract" && (
        <>
          {select("运算方式", "mode", node.mode, extractModeOptions)}
          <Parameter
            label="输入值"
            value={node.source}
            nodes={sources}
            change={(value) => set("source", value)}
          />
          {["REGEX", "JSON"].includes(node.mode) &&
            field("表达式 / JSON 路径", "expression", node.expression)}
          {node.mode === "REGEX" && field("捕获组", "group", node.group, true)}
          {node.mode === "SUB" && (
            <>
              {field("起始位置", "startIndex", node.startIndex, true)}
              {field("长度（-1 到结尾）", "length", node.length, true)}
            </>
          )}
          {node.mode === "CONCAT" && (
            <>
              {node.others.map((value, index) => (
                <Stack key={index}>
                  <Parameter
                    label={"拼接值 " + (index + 1)}
                    value={value}
                    nodes={sources}
                    change={(next) =>
                      set(
                        "others",
                        node.others.map((item, i) =>
                          i === index ? next : item,
                        ),
                      )
                    }
                  />
                  <Button
                    onClick={() =>
                      set(
                        "others",
                        node.others.filter((_, i) => i !== index),
                      )
                    }
                  >
                    移除
                  </Button>
                </Stack>
              ))}
              <Button
                onClick={() => set("others", [...node.others, { value: "" }])}
              >
                添加拼接值
              </Button>
            </>
          )}
          {["RANDOM_INT", "RANDOM_STRING"].includes(node.mode) && (
            <>
              <FormControlLabel
                label="使用固定值"
                control={
                  <Switch
                    checked={node.useFixed}
                    onChange={(_, checked) => set("useFixed", checked)}
                  />
                }
              />
              {node.useFixed ? (
                field("固定值", "fixedValue", node.fixedValue)
              ) : node.mode === "RANDOM_INT" ? (
                <>
                  {field("最小值", "randomMin", node.randomMin, true)}
                  {field("最大值", "randomMax", node.randomMax, true)}
                </>
              ) : (
                <>
                  {field(
                    "长度",
                    "randomStringLength",
                    node.randomStringLength,
                    true,
                  )}
                  {field(
                    "字符集",
                    "randomStringCharset",
                    node.randomStringCharset,
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Stack>
  );
}



