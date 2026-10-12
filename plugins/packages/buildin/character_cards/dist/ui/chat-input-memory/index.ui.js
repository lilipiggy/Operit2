// @operit-compose-artifact 1
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/ui/chat-input-memory/index.ui.ts
var index_ui_exports = {};
__export(index_ui_exports, {
  default: () => Screen
});
module.exports = __toCommonJS(index_ui_exports);

// src/validation.ts
function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
}

// src/chat-markers.ts
function markerValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(path + " must be a finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map(
    /** Validates and copies every actual nested JSON value. */
    (item, index) => markerValue(item, path + "[" + index + "]")
  );
  return markerObject(value, path);
}
function markerObject(value, path) {
  assertObject(value, path);
  const result = {};
  for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: markerValue(item, path + "." + key), enumerable: true, configurable: true, writable: true });
  return result;
}

// src/domain.ts
function record(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be a JSON object`);
  return value;
}
function text(value, path) {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
}
function nonblank(value, path) {
  text(value, path);
  if (value.trim() === "") throw new Error(`${path} must not be blank`);
}
function parseMemoryIdentifier(value, path, positive = true) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${path} must be a canonical decimal string`);
  const id2 = BigInt(value);
  if (id2 > 9223372036854775807n || positive && id2 === 0n) throw new Error(`${path} is outside its declared identity range`);
  return value;
}
function memoryIdentifier(value, path) {
  parseMemoryIdentifier(value, path);
}
function propertyIdentifier(value, path) {
  parseMemoryIdentifier(value, path, false);
}
function boolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}
function number(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}
function integer(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${path} must be a safe integer`);
}
function messageVariant(value, path) {
  integer(value, path);
  if (typeof value !== "number" || value < 0 || value > 2147483647) throw new Error(path + " must be a nonnegative i32 message variant index");
}
function score(value, path) {
  number(value, path);
  if (value < 0 || value > 1) throw new Error(`${path} must be between 0 and 1`);
}
function nonnegative(value, path) {
  number(value, path);
  if (value < 0) throw new Error(`${path} must not be negative`);
}
function enumeration(...values) {
  const allowed = new Set(values);
  return (value, path) => {
    if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${path} must be ${values.join(" | ")}`);
  };
}
function nullable(validate) {
  return (value, path) => {
    if (value !== null) validate(value, path);
  };
}
function array(validate) {
  return (value, path) => {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    for (let index = 0; index < value.length; index += 1) validate(value[index], `${path}[${index}]`);
  };
}
function required(validate) {
  return { validate, required: true };
}
function optional(validate) {
  return { validate, required: false };
}
function shape(fields, nonempty = false) {
  return (value, path) => {
    const object = record(value, path);
    const keys = Object.keys(object);
    if (nonempty && keys.length === 0) throw new Error(`${path} must contain at least one field`);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new Error(`${path}.${key} is not a supported field`);
      fields[key].validate(object[key], `${path}.${key}`);
    }
    for (const key of Object.keys(fields)) {
      if (fields[key].required && !Object.prototype.hasOwnProperty.call(object, key)) throw new Error(`${path}.${key} is required`);
    }
  };
}
function owner(value, path) {
  if (typeof value !== "string" || !/^(character|shared):[^:\s]+$/.test(value)) throw new Error(`${path} must be character:<id> or shared:<id>`);
}
var strings = array(text);
var identifiers = array(nonblank);
var member = shape({ characterCardId: required(nonblank), orderIndex: required(integer) });
var mount = shape({ sharedMemoryId: required(nonblank), readable: required(boolean), writable: required(boolean) });
var toolAccess = shape({ enabled: required(boolean), allowedBuiltinTools: required(strings), allowedPackages: required(strings), allowedSkills: required(strings), allowedMcpServers: required(strings) });
var property = shape({ id: required(propertyIdentifier), key: required(text), value: required(text) });
var characterFields = {
  name: optional(nonblank),
  description: optional(text),
  characterSetting: optional(text),
  openingStatement: optional(text),
  otherContentChat: optional(text),
  otherContentVoice: optional(text),
  avatarUri: optional(nullable(text)),
  attachedTagIds: optional(identifiers),
  advancedCustomPrompt: optional(text),
  marks: optional(text),
  chatModelBindingMode: optional(enumeration("FOLLOW_GLOBAL", "FIXED_MODEL")),
  chatModelId: optional(nullable(text)),
  ttsConfigId: optional(nullable(text)),
  themeConfigId: optional(nullable(text)),
  memoryBindingMode: optional(enumeration("CHARACTER", "SHARED")),
  sharedMemoryId: optional(nullable(text)),
  sharedMemoryMounts: optional(array(mount)),
  toolAccessConfig: optional(toolAccess),
  isDefault: optional(boolean),
  createdAt: optional(integer),
  updatedAt: optional(integer)
};
var groupFields = { name: optional(nonblank), description: optional(text), themeConfigId: optional(nullable(text)), members: optional(array(member)), createdAt: optional(integer), updatedAt: optional(integer) };
var tagFields = { name: optional(nonblank), description: optional(text), promptContent: optional(text), tagType: optional(enumeration("TONE", "CHARACTER", "FUNCTION", "CUSTOM")), createdAt: optional(integer), updatedAt: optional(integer) };
var memoryFields = {
  uuid: optional(text),
  title: optional(nonblank),
  content: optional(text),
  contentType: optional(text),
  source: optional(text),
  credibility: optional(score),
  importance: optional(score),
  documentPath: optional(nullable(text)),
  isDocumentNode: optional(boolean),
  chunkIndexFilePath: optional(nullable(text)),
  folderPath: optional(nullable(text)),
  createdAt: optional(integer),
  updatedAt: optional(integer),
  lastAccessedAt: optional(integer),
  tags: optional(strings),
  properties: optional(array(property))
};
var settings = shape({
  autoSaveIntervalMinutes: required(nonnegative),
  nextAutoSaveRunAtMs: required(integer),
  memoryExtractionCustomRules: required(text),
  profileAutoUpdateEnabled: required(boolean),
  profileAutoUpdateLocked: required(boolean),
  cloudEmbeddingEnabled: required(boolean),
  cloudEmbeddingEndpoint: required(text),
  cloudEmbeddingApiKey: required(text),
  cloudEmbeddingModel: required(text)
});
var searchConfig = shape({ scoreMode: required(enumeration("BALANCED", "KEYWORD_FIRST", "SEMANTIC_FIRST")), keywordWeight: required(nonnegative), tagWeight: required(nonnegative), vectorWeight: required(nonnegative), edgeWeight: required(nonnegative) });
var empty = shape({});
var id = shape({ id: required(nonblank) });
var ownerOnly = shape({ ownerKey: required(owner) });
var contentOnly = shape({ content: required(text) });
var format = enumeration("operit", "tavern");
var memoryQueryRequest = shape({ participantId: required(nonblank), query: required(nonblank), limit: required(nonnegative), snapshotId: required(nullable(nonblank)) });
var validators = {
  "memory.searchWithOptions": shape({ ownerKey: required(owner), query: required(text), folderPath: required(nullable(text)), relevanceThreshold: required(nonnegative), createdAtStartMs: required(nullable(integer)), createdAtEndMs: required(nullable(integer)) }),
  "memory.chat.list": ownerOnly,
  "memory.chat.update": shape({ ownerKey: required(owner), chatId: required(nonblank) }),
  "memory.categorize": ownerOnly,
  "memory.rebuild.start": shape({ ownerKey: required(owner), rebuild: required(shape({ chatIds: required(strings), windowMessageCount: required(integer), fromInclusive: required(nullable(integer)), toInclusive: required(nullable(integer)) })) }),
  "memory.rebuild.progress": ownerOnly,
  "memory.rebuild.cancel": ownerOnly,
  "memory.embeddings.rebuild": ownerOnly,
  "memory.candidate.enqueue": shape({ chatId: required(nonblank), timestamp: required(integer), variantIndex: required(messageVariant), sourceType: required(enumeration("reply_finalized_auto", "selected_user_message")), ownerKey: required(nullable(owner)) }),
  "chat.configuration.resolve": parseChatConfigurationRequest,
  "chat.configuration.binding.read": shape({ chatId: required(nonblank) }),
  "chat.configuration.binding.write": shape({ chatId: required(nonblank), selection: required(nonblank) }),
  "chat.configuration.binding.delete": shape({ chatId: required(nonblank) }),
  snapshot: empty,
  "character.list": empty,
  "character.get": id,
  "character.create": shape({ values: required(shape({ ...characterFields, id: optional(text), name: required(nonblank) })) }),
  "character.update": shape({ id: required(nonblank), changes: required(shape(characterFields, true)) }),
  "character.delete": id,
  "character.setActive": id,
  "character.combine": shape({ id: required(nonblank), promptFunctionType: optional(enumeration("CHAT", "VOICE")), additionalTagIds: optional(identifiers) }),
  "character.resetDefault": empty,
  "character.export": shape({ id: required(nonblank), format: required(format) }),
  "character.import": shape({ format: required(format), content: required(nonblank) }),
  "character.exportBackup": empty,
  "character.importBackup": contentOnly,
  "group.list": empty,
  "group.get": id,
  "group.create": shape({ values: required(shape({ ...groupFields, id: optional(text), name: required(nonblank) })) }),
  "group.update": shape({ id: required(nonblank), changes: required(shape(groupFields, true)) }),
  "group.delete": id,
  "group.setActive": id,
  "group.duplicate": shape({ id: required(nonblank), newName: optional(nonblank) }),
  "group.export": id,
  "group.import": contentOnly,
  "group.exportBackup": empty,
  "group.importBackup": contentOnly,
  "activePrompt.get": empty,
  "activePrompt.setCard": id,
  "activePrompt.setGroup": id,
  "activePrompt.activateForChat": shape({ characterCardName: required(nullable(nonblank)), characterGroupId: required(nullable(nonblank)) }),
  "activePrompt.resolvedCard": empty,
  "tag.list": empty,
  "tag.get": id,
  "tag.create": shape({ values: required(shape({ ...tagFields, id: optional(text), name: required(nonblank) })) }),
  "tag.update": shape({ id: required(nonblank), changes: required(shape(tagFields, true)) }),
  "tag.delete": id,
  "memory.shared.list": empty,
  "memory.shared.create": shape({ name: required(nonblank) }),
  "memory.shared.rename": shape({ id: required(nonblank), name: required(nonblank) }),
  "memory.shared.delete": id,
  "memory.mount": shape({ characterId: required(nonblank), sharedId: required(nonblank), readable: required(boolean), writable: required(boolean) }),
  "memory.unmount": shape({ characterId: required(nonblank), sharedId: required(nonblank) }),
  "memory.user.read": ownerOnly,
  "memory.user.write": shape({ ownerKey: required(owner), content: required(text) }),
  "memory.user.path": ownerOnly,
  "memory.resolveOwner": shape({ characterId: required(nonblank) }),
  "memory.settings.read": ownerOnly,
  "memory.settings.write": shape({ ownerKey: required(owner), settings: required(settings) }),
  "memory.searchConfig.read": ownerOnly,
  "memory.searchConfig.write": shape({ ownerKey: required(owner), config: required(searchConfig) }),
  "memory.graph": ownerOnly,
  "memory.list": ownerOnly,
  "memory.search": shape({ ownerKey: required(owner), query: required(nonblank) }),
  "memory.get": shape({ ownerKey: required(owner), title: required(nonblank) }),
  "memory.create": shape({ ownerKey: required(owner), values: required(shape({ ...memoryFields, id: optional(memoryIdentifier), title: required(nonblank), content: required(text) })) }),
  "memory.update": shape({ ownerKey: required(owner), originalTitle: required(nonblank), expectedId: optional(memoryIdentifier), changes: required(shape(memoryFields, true)) }),
  "memory.delete": shape({ ownerKey: required(owner), id: required(memoryIdentifier) }),
  "memory.move": shape({ ownerKey: required(owner), ids: required(array(memoryIdentifier)), folderPath: required(text) }),
  "memory.link.create": shape({ ownerKey: required(owner), sourceTitle: required(nonblank), targetTitle: required(nonblank), linkType: required(nonblank), weight: required(score), description: required(text) }),
  "memory.link.update": shape({ ownerKey: required(owner), linkId: required(memoryIdentifier), changes: required(shape({ linkType: optional(nonblank), weight: optional(score), description: optional(text) }, true)) }),
  "memory.link.delete": shape({ ownerKey: required(owner), linkId: required(memoryIdentifier) }),
  "memory.export": ownerOnly,
  "memory.import": shape({ ownerKey: required(owner), content: required(nonblank), strategy: required(enumeration("SKIP", "UPDATE", "CREATE_NEW")) })
};
function parseChatConfigurationRequest(value) {
  shape({
    purpose: required(enumeration("display", "execution")),
    chatId: required(nullable(nonblank)),
    chatExtension: required(nullable(markerObject)),
    messageExtension: required(nullable(markerObject)),
    participantId: required(nullable(nonblank)),
    promptFunctionType: required(enumeration("CHAT", "VOICE")),
    defaultModelBinding: required(shape({ providerId: required(text), modelId: required(text) })),
    defaultTtsConfigId: required(text)
  })(value, "chat.configuration.resolve");
  const request2 = value;
  if (request2.purpose === "display") {
    if (request2.participantId !== null || request2.messageExtension !== null) throw new Error("Display configuration cannot request an execution participant or message snapshot");
  } else {
    nonblank(request2.defaultModelBinding.providerId, "execution default provider");
    nonblank(request2.defaultModelBinding.modelId, "execution default model");
    nonblank(request2.defaultTtsConfigId, "execution default TTS configuration");
  }
  return request2;
}

// src/definition.ts
var definition = { id: "com.operit.character_cards", title: "\u89D2\u8272\u5361", icon: "Badge", order: 150 };
var chatUiRoutes = {
  editor: `toolpkg:${definition.id}:ui:main`,
  selection: `toolpkg:${definition.id}:ui:selection`,
  execution: `toolpkg:${definition.id}:ui:group-execution`
};

// src/ui-contributions.ts
function chatIdentity(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(label + " must be a nonblank string");
  return value;
}

// src/ui-memory-menu.ts
function request(input) {
  return ToolPkg.ipc.call("character-memory.request", input, { targetRuntime: "main" });
}
function memorySummary(preferences) {
  if (preferences.userDescriptionEnabled) return preferences.autoUpdateEnabled ? "\u7528\u6237\u8D44\u6599 \xB7 \u8BB0\u5FC6\u5E93\u66F4\u65B0" : "\u7528\u6237\u8D44\u6599";
  return preferences.autoUpdateEnabled ? "\u8BB0\u5FC6\u5E93\u66F4\u65B0" : "\u5173";
}
function memoryQueueDescription(queue) {
  if (queue === null) return "\u6682\u65E0\u961F\u5217\u72B6\u6001\u3002\u81EA\u52A8\u63D0\u53D6\u4F1A\u5B9A\u671F\u68C0\u67E5\u5F53\u524D\u8BB0\u5FC6\u5E93\u3002";
  return `\u5F85\u5904\u7406 ${queue.pendingCandidates} \u6761 \xB7 ${queue.pendingChats} \u4E2A\u804A\u5929
\u5904\u7406\u4E2D ${queue.processingCandidates} \xB7 \u5931\u8D25 ${queue.failedCandidates}
\u4E0B\u6B21\u68C0\u67E5\uFF1A\u7EA6 ${queue.minutesUntilNextRun} \u5206\u949F\u540E

\u81EA\u52A8\u68C0\u67E5\u9700\u8981\u81F3\u5C11 5 \u4E2A\u5019\u9009\uFF1B\u4E0D\u8DB3\u65F6\u7EE7\u7EED\u7B49\u5F85\u3002\u624B\u52A8\u66F4\u65B0\u4E0D\u53D7\u6B64\u95E8\u69DB\u9650\u5236\u3002` + (queue.lastError === "" ? "" : "\n\n" + queue.lastError);
}
function renderMemoryMenu(ctx) {
  const [chatId] = ctx.useState("chatId", null);
  if (chatId !== null) chatIdentity(chatId, "memory menu chatId");
  const owner2 = ctx.useRef("memory-menu-chat", chatId);
  const [preferences, setPreferences] = ctx.useState("memory-menu-preferences", null);
  const [, setQueue] = ctx.useState("memory-menu-queue", null);
  const [expanded, setExpanded] = ctx.useState("memory-menu-expanded", false);
  const [busy, setBusy] = ctx.useState("memory-menu-busy", false);
  const liveBusy = ctx.useRef("memory-menu-busy-live", false);
  const started = ctx.useRef("memory-menu-started", false);
  const colors = ctx.MaterialTheme.colorScheme;
  function assertOwner() {
    const [current] = ctx.useState("chatId", null);
    if (current !== owner2.current) throw new Error("Memory menu chat owner changed");
  }
  assertOwner();
  function refreshQueue() {
    return __async(this, null, function* () {
      assertOwner();
      if (chatId === null) return;
      const value = yield request({ action: "readChatMemoryAutoSaveStatus", chatId });
      assertOwner();
      setQueue(value);
    });
  }
  function load() {
    return __async(this, null, function* () {
      assertOwner();
      if (started.current) return;
      started.current = true;
      const value = yield request({ action: "readGlobalMemoryPreferences" });
      assertOwner();
      setPreferences(value);
      yield refreshQueue();
    });
  }
  function showInfo() {
    return __async(this, null, function* () {
      yield refreshQueue();
      assertOwner();
      const [current] = ctx.useState("memory-menu-queue", null);
      return { type: "toolpkg.ui.present", routeId: `toolpkg:${definition.id}:ui:memory-status`, input: { description: memoryQueueDescription(current) } };
    });
  }
  function toggle(key) {
    return __async(this, null, function* () {
      assertOwner();
      const [current] = ctx.useState("memory-menu-preferences", null);
      if (current === null) throw new Error("Memory preferences are not loaded");
      const value = yield request({ action: "writeGlobalMemoryPreference", key, value: !current[key] });
      assertOwner();
      setPreferences(value);
    });
  }
  function manual() {
    return __async(this, null, function* () {
      assertOwner();
      if (liveBusy.current || chatId === null) return null;
      liveBusy.current = true;
      setBusy(true);
      try {
        yield request({ action: "updateCurrentChatMemory", chatId });
        assertOwner();
        yield refreshQueue();
        return { type: "toolpkg.ui.message", message: "\u8BB0\u5FC6\u63D0\u53D6\u5B8C\u6210" };
      } catch (error) {
        assertOwner();
        return { type: "toolpkg.ui.message", message: "\u8BB0\u5FC6\u63D0\u53D6\u5931\u8D25\uFF1A" + String(error) };
      } finally {
        liveBusy.current = false;
        assertOwner();
        setBusy(false);
      }
    });
  }
  function icon(name, color = colors.onSurfaceVariant) {
    return OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:20972",[name,color],()=>[{ name, size: 16, tint: color }],(...__operitArgs)=>ctx.UI.Icon(...__operitArgs));
  }
  function switchRow(key, name, title) {
    if (preferences === null) throw new Error("Memory preferences are not loaded");
    const checked = preferences[key];
    return OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21196",[{
      key: "memory-" + key,
      fillMaxWidth: true,
      paddingHorizontal: 12,
      verticalAlignment: "center",
      modifier: ctx.Modifier.heightIn({ minHeight: 32 }),
      onClick: () => toggle(key)
    },[
      icon(name, checked ? colors.primary : colors.onSurfaceVariant),
      OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21503",[],()=>[{ width: 12 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
      OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21539",[{ text: title, style: "bodySmall", color: colors.onSurface, maxLines: 1, overflow: "ellipsis", weight: 1 }],(...__operitArgs)=>ctx.UI.Text(...__operitArgs)),
      OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21666",[{ text: checked ? "\u5F00" : "\u5173", style: "bodySmall", color: colors.primary, fontWeight: "600" }],(...__operitArgs)=>ctx.UI.Text(...__operitArgs)),
      OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21788",[],()=>[{ width: 8 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
      OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21823",[{ checked, width: 40, height: 28, onCheckedChange: () => toggle(key) }],(...__operitArgs)=>ctx.UI.Switch(...__operitArgs))
    ]],(...__operitArgs)=>ctx.UI.Row(...__operitArgs));
  }
  if (preferences === null) return OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:21956",[load],()=>[{ key: "memory-menu-loading", onLoad: load }],(...__operitArgs)=>ctx.UI.Box(...__operitArgs));
  const children = [OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22034",[{
    key: "memory-section-header",
    fillMaxWidth: true,
    paddingHorizontal: 12,
    verticalAlignment: "center",
    modifier: ctx.Modifier.heightIn({ minHeight: 36 }),
    onClick: () => {
      assertOwner();
      setExpanded(!expanded);
    }
  },[
    icon("DataObjectOutlined", colors.onSurfaceVariant.copy({ alpha: 0.7 })),
    OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22388",[],()=>[{ width: 12 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
    OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22422",[],()=>[{ text: "\u8BB0\u5FC6", style: "bodySmall" }],(...__operitArgs)=>ctx.UI.Text(...__operitArgs)),
    OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22485",[],()=>[{ width: 8 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
    OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22518",[{ text: memorySummary(preferences), style: "bodySmall", color: colors.primary, fontWeight: "600", textAlign: "end", maxLines: 1, overflow: "ellipsis", weight: 1 }],(...__operitArgs)=>ctx.UI.Text(...__operitArgs)),
    OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22699",[{
      key: "memory-info",
      tooltip: "\u8BB0\u5FC6\u72B6\u6001\u8BF4\u660E",
      width: 24,
      height: 28,
      contentPadding: { horizontal: 0, vertical: 0 },
      onClick: showInfo,
      content: OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:22929",[{ name: "InfoOutline", size: 16, tint: colors.onSurfaceVariant.copy({ alpha: 0.7 }) }],(...__operitArgs)=>ctx.UI.Icon(...__operitArgs))
    }],(...__operitArgs)=>ctx.UI.IconButton(...__operitArgs)),
    OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23040",[],()=>[{ width: 6 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
    OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23073",[{ name: expanded ? "KeyboardArrowUp" : "KeyboardArrowDown", size: 20, tint: colors.onSurfaceVariant }],(...__operitArgs)=>ctx.UI.Icon(...__operitArgs))
  ]],(...__operitArgs)=>ctx.UI.Row(...__operitArgs))];
  if (expanded) children.push(OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23225",[{ key: "memory-section-children", modifier: ctx.Modifier.padding(12, 0, 8, 4) },[
    switchRow("userDescriptionEnabled", "AssignmentIndOutlined", "\u63D0\u4F9B\u7528\u6237\u8D44\u6599"),
    switchRow("autoUpdateEnabled", preferences.autoUpdateEnabled ? "Save" : "SaveOutlined", "\u81EA\u52A8\u66F4\u65B0\u8BB0\u5FC6\u5E93"),
    OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23571",[{
      key: "memory-manual",
      fillMaxWidth: true,
      paddingHorizontal: 12,
      verticalAlignment: "center",
      modifier: ctx.Modifier.heightIn({ minHeight: 32 }),
      onClick: !busy && chatId !== null ? manual : void 0
    },[
      icon("SaveOutlined"),
      OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23861",[],()=>[{ width: 12 }],(...__operitArgs)=>ctx.UI.Spacer(...__operitArgs)),
      OperitComposeGeneration.node(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:23897",[{
        text: busy ? "\u6B63\u5728\u66F4\u65B0\u8BB0\u5FC6\u2026" : "\u624B\u52A8\u66F4\u65B0\u8BB0\u5FC6",
        style: "bodySmall",
        maxLines: 2,
        overflow: "ellipsis",
        weight: 1,
        color: !busy && chatId !== null ? colors.onSurface : colors.onSurfaceVariant.copy({ alpha: 0.45 })
      }],(...__operitArgs)=>ctx.UI.Text(...__operitArgs))
    ]],(...__operitArgs)=>ctx.UI.Row(...__operitArgs))
  ]],(...__operitArgs)=>ctx.UI.Column(...__operitArgs)));
  return OperitComposeGeneration.leaf(ctx,"com.operit.character_cards:dist/ui/chat-input-memory/index.ui.js:24256",[children],()=>[{ key: "memory-section", fillMaxWidth: true },children],(...__operitArgs)=>ctx.UI.Column(...__operitArgs));
}

// src/ui/chat-input-memory/index.ui.ts
function Screen(ctx) {
  return renderMemoryMenu(ctx);
}
