mod renderer;

use super::{app::OperitTui, i18n::TuiText, link_proxy_rs::TuiCore};
use operit_link::{CoreEventKind, CoreEventStream};
use ratatui::text::Line;
use renderer::{Hit, Node};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::Range;

pub(super) type SurfaceKey = (i64, usize, String);

/// Identifies a node already recognized by the message Markdown renderer.
#[derive(Clone, Debug)]
pub(super) struct XmlSurfaceSlot {
    pub key: SurfaceKey,
    pub tag: String,
    pub content: String,
    pub lines: Range<usize>,
}

/// Owns a plugin's existing Compose execution context and action stream.
struct Session {
    package: String,
    context: String,
    script: String,
    module: String,
    options: BTreeMap<String, Value>,
    tree: Option<Node>,
    error: Option<String>,
    stream: Option<CoreEventStream>,
    loaded_key: Option<String>,
}

struct Entry {
    content: String,
    session: Option<Session>,
    replacement: Option<String>,
    error: Option<String>,
}

#[derive(Default)]
pub(super) struct ComposeHost {
    chat: Option<String>,
    entries: HashMap<SurfaceKey, Entry>,
    hits: Vec<(SurfaceKey, Hit)>,
    pressed: Option<(SurfaceKey, String)>,
    pub editor: Option<Editor>,
}

pub(super) struct Editor {
    key: SurfaceKey,
    action: String,
    pub value: String,
}

/// Reads a required string from a protocol object without interpreting its content.
fn required(value: &Value, name: &str) -> Result<String, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Compose response is missing {name}"))
}

impl Session {
    /// Accepts the canonical tree and state returned by the JavaScript runtime.
    fn update(&mut self, raw: &str) -> Result<(), String> {
        let result: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
        if result.get("success").and_then(Value::as_bool) == Some(false) {
            return Err(format!("Compose render failed: {result}"));
        }
        if result
            .get("navigationCommands")
            .and_then(Value::as_array)
            .is_some_and(|commands| !commands.is_empty())
        {
            return Err(
                "Navigation is not supported in an embedded terminal Compose surface".into(),
            );
        }
        let tree = serde_json::from_value(
            result
                .get("tree")
                .ok_or_else(|| format!("Compose result is missing tree: {result}"))?
                .clone(),
        )
        .map_err(|error| error.to_string())?;
        for name in ["state", "memo"] {
            let value = result
                .get(name)
                .filter(|value| value.is_object())
                .ok_or_else(|| format!("Compose result is missing {name}"))?;
            self.options.insert(name.into(), value.clone());
        }
        self.tree = Some(tree);
        self.error = None;
        Ok(())
    }

    /// Dispatches callbacks through the same Core action stream used by graphical clients.
    async fn dispatch(
        &mut self,
        core: &mut TuiCore,
        id: String,
        payload: Option<Value>,
    ) -> Result<(), String> {
        if self.stream.is_some() {
            return Err("This plugin UI is processing an action".into());
        }
        let mut application = core.application();
        self.stream = Some(
            application
                .packageManager()
                .dispatchToolPkgComposeDslActionEvents(
                    self.context.clone(),
                    self.package.clone(),
                    id,
                    payload,
                    self.options.clone(),
                    BTreeMap::new(),
                )
                .await
                .map_err(|error| error.to_string())?,
        );
        Ok(())
    }

    /// Drains available intermediate renders without blocking the terminal event loop.
    fn poll(&mut self) -> Result<(), String> {
        loop {
            let event = match self.stream.as_mut() {
                None => break,
                Some(stream) => match stream.try_recv() {
                    Ok(event) => event,
                    Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                    Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                        self.stream = None;
                        break;
                    }
                },
            };
            if event.kind == CoreEventKind::Completed {
                self.stream = None;
                break;
            }
            let raw: String =
                operit_link::fromCoreValue(event.value).map_err(|error| error.to_string())?;
            let value: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
            match value.get("phase").and_then(Value::as_str) {
                Some("intermediate" | "final") => self.update(&required(&value, "result")?)?,
                Some("complete") => {
                    self.stream = None;
                    break;
                }
                Some("error") => {
                    self.stream = None;
                    return Err(required(&value, "error")?);
                }
                phase => return Err(format!("Unknown Compose action phase: {phase:?}")),
            }
        }
        Ok(())
    }

    /// Runs the root load callback once per mounted root key.
    async fn load(&mut self, core: &mut TuiCore) -> Result<(), String> {
        if self.stream.is_some() || self.error.is_some() {
            return Ok(());
        }
        let Some(tree) = &self.tree else {
            return Ok(());
        };
        let key = tree
            .props
            .get("key")
            .map(Value::to_string)
            .unwrap_or_default();
        if self.loaded_key.as_ref() == Some(&key) {
            return Ok(());
        }
        self.loaded_key = Some(key);
        if let Some(id) = renderer::action(tree.props.get("onLoad"))? {
            self.dispatch(core, id, None).await?;
        }
        Ok(())
    }

    /// Releases ownership of this message's plugin execution context.
    async fn release(&mut self, core: &mut TuiCore) -> Result<(), String> {
        self.stream = None;
        core.application()
            .packageManager()
            .releaseToolPkgExecutionEngine(&self.context, &self.package)
            .await
            .map_err(|error| error.to_string())
    }
}

impl ComposeHost {
    /// Synchronizes message-owned surfaces using the XML nodes emitted by the renderer.
    pub async fn sync(
        &mut self,
        core: &mut TuiCore,
        chat: Option<String>,
        live: HashSet<i64>,
        slots: Vec<XmlSurfaceSlot>,
    ) -> Result<(), String> {
        if self.chat != chat {
            self.clear(core).await?;
            self.chat = chat;
            return Ok(());
        }
        let visible_keys = slots
            .iter()
            .map(|slot| slot.key.clone())
            .collect::<HashSet<_>>();
        let stale = self
            .entries
            .keys()
            .filter(|key| !live.contains(&key.0) || !visible_keys.contains(*key))
            .cloned()
            .collect::<Vec<_>>();
        for key in stale {
            if let Some(mut entry) = self.entries.remove(&key) {
                if let Some(session) = &mut entry.session {
                    session.release(core).await?;
                }
            }
        }
        for entry in self.entries.values_mut() {
            if let Some(session) = &mut entry.session {
                if session.stream.is_some() {
                    self.pressed = None;
                }
                if let Err(error) = session.poll() {
                    session.error = Some(error);
                    session.stream = None;
                }
                if let Err(error) = session.load(core).await {
                    session.error = Some(error);
                }
            }
        }
        for slot in slots {
            if !live.contains(&slot.key.0) {
                continue;
            }
            if self.entries.get(&slot.key).is_some_and(|entry| {
                entry.content == slot.content
                    || entry
                        .session
                        .as_ref()
                        .is_some_and(|session| session.stream.is_some())
            }) {
                continue;
            }
            self.pressed = None;
            let rendered = core
                .chat_runtime_holder_main()
                .renderToolPkgXml(slot.tag.clone(), slot.content.clone(), self.chat.clone())
                .await
                .map_err(|error| error.to_string())?;
            let mut entry = self.entries.remove(&slot.key).unwrap_or(Entry {
                content: String::new(),
                session: None,
                replacement: None,
                error: None,
            });
            entry.content = slot.content.clone();
            let result = self.update_entry(core, &slot, &rendered, &mut entry).await;
            entry.error = result.err();
            self.entries.insert(slot.key, entry);
        }
        Ok(())
    }

    /// Mounts or updates the render result of the registered XML plugin.
    async fn update_entry(
        &self,
        core: &mut TuiCore,
        slot: &XmlSurfaceSlot,
        rendered: &Value,
        entry: &mut Entry,
    ) -> Result<(), String> {
        if rendered.is_null() {
            return Ok(());
        }
        match rendered.get("kind").and_then(Value::as_str) {
            Some("text") => {
                entry.replacement = Some(required(rendered, "text")?);
            }
            Some("composeDsl") => {
                let package = required(rendered, "containerPackageName")?;
                let module = required(rendered, "screen")?;
                if entry.session.is_none() {
                    let mut application = core.application();
                    let mut manager = application.packageManager();
                    let script = manager
                        .readToolPkgTextResource(&package, &module, true)
                        .await
                        .map_err(|error| error.to_string())?
                        .ok_or("Compose screen script is missing")?;
                    let screen = module.clone();
                    let context =
                        format!("tui-xml:{}", json!([self.chat, slot.key, package, module]));
                    manager
                        .acquireToolPkgExecutionEngine(&context, &package)
                        .await
                        .map_err(|error| error.to_string())?;
                    entry.session = Some(Session {
                        package: package.clone(),
                        context: context.clone(),
                        script,
                        module: module.clone(),
                        options: BTreeMap::from([
                            ("packageName".into(), json!(package)),
                            ("containerPackageName".into(), json!(package)),
                            ("toolPkgId".into(), json!(package)),
                            ("uiModuleId".into(), json!(module)),
                            ("__operit_toolpkg_runtime_kind".into(), json!("ui")),
                            ("routeInstanceId".into(), json!(context)),
                            ("executionContextKey".into(), json!(context)),
                            ("__operit_script_screen".into(), json!(screen)),
                            (
                                "moduleSpec".into(),
                                rendered.get("moduleSpec").cloned().unwrap_or(Value::Null),
                            ),
                            ("state".into(), json!({})),
                            (
                                "memo".into(),
                                rendered.get("memo").cloned().unwrap_or(json!({})),
                            ),
                        ]),
                        tree: None,
                        error: None,
                        stream: None,
                        loaded_key: None,
                    });
                }
                let session = entry.session.as_mut().ok_or("Missing Compose session")?;
                if session.package != package || session.module != module {
                    return Err("XML surface changed its plugin owner or screen".into());
                }
                let state = rendered
                    .get("state")
                    .and_then(Value::as_object)
                    .ok_or("XML renderer state is missing")?;
                session
                    .options
                    .get_mut("state")
                    .and_then(Value::as_object_mut)
                    .ok_or("Compose state must be an object")?
                    .extend(state.clone());
                let raw = core
                    .application()
                    .packageManager()
                    .executeToolPkgComposeDslScript(
                        &session.context,
                        &session.package,
                        &session.script,
                        session.options.clone(),
                        BTreeMap::new(),
                    )
                    .await
                    .map_err(|error| error.to_string())?
                    .ok_or("Compose returned no render result")?;
                session.update(&raw)?;
                session.load(core).await?;
            }
            kind => return Err(format!("Unsupported XML render result: {kind:?}")),
        }
        Ok(())
    }

    /// Renders mounted surfaces in place and translates every hit into transcript coordinates.
    pub fn project(
        &mut self,
        lines: &mut Vec<Line<'static>>,
        slots: &[XmlSurfaceSlot],
        folds: &mut Vec<super::fold::TranscriptFoldHit>,
        width: usize,
        locale: TuiText,
    ) {
        self.hits.clear();
        let mut replacements = Vec::new();
        for slot in slots {
            let Some(entry) = self.entries.get(&slot.key) else {
                continue;
            };
            let rendered = if let Some(error) = &entry.error {
                Err(error.clone())
            } else if let Some(session) = &entry.session {
                match (&session.tree, &session.error) {
                    (_, Some(error)) => Err(error.clone()),
                    (Some(tree), None) => renderer::render(tree, width, locale),
                    (None, None) => Err("Compose surface has no tree".into()),
                }
            } else if let Some(text) = &entry.replacement {
                Ok(renderer::Surface {
                    lines: super::markdown::render_markdown_lines(text, width, locale),
                    hits: Vec::new(),
                })
            } else {
                continue;
            };
            let surface = match rendered {
                Ok(mut surface) => {
                    if entry
                        .session
                        .as_ref()
                        .is_some_and(|session| session.stream.is_some())
                    {
                        surface.hits.clear();
                    }
                    surface
                }
                Err(error) => renderer::Surface {
                    lines: vec![Line::from(format!("Plugin UI: {error}"))],
                    hits: Vec::new(),
                },
            };
            replacements.push((slot, surface));
        }
        // Apply from the bottom so source ranges continue to refer to the original transcript.
        replacements.sort_by_key(|(slot, _)| std::cmp::Reverse(slot.lines.start));
        for (slot, surface) in replacements {
            let delta = surface.lines.len() as isize - slot.lines.len() as isize;
            folds.retain(|hit| !slot.lines.contains(&hit.line_index));
            for hit in folds
                .iter_mut()
                .filter(|hit| hit.line_index >= slot.lines.end)
            {
                hit.line_index = hit.line_index.saturating_add_signed(delta);
            }
            for (_, hit) in &mut self.hits {
                hit.row = hit.row.saturating_add_signed(delta);
            }
            self.hits.extend(surface.hits.into_iter().map(|mut hit| {
                hit.row += slot.lines.start;
                (slot.key.clone(), hit)
            }));
            lines.splice(slot.lines.clone(), surface.lines);
        }
    }

    /// Captures a press only when it targets an enabled plugin control.
    pub fn press(&mut self, row: usize, column: usize) -> bool {
        self.pressed = self
            .hits
            .iter()
            .find(|(_, hit)| hit.row == row && column >= hit.start && column < hit.end)
            .map(|(key, hit)| (key.clone(), hit.action.clone()));
        self.pressed.is_some()
    }

    /// Activates a control only when release still targets the same action and instance.
    pub async fn release_click(
        &mut self,
        core: &mut TuiCore,
        row: usize,
        column: usize,
    ) -> Result<bool, String> {
        let Some((key, id)) = self.pressed.take() else {
            return Ok(false);
        };
        if let Some((_, hit)) = self
            .hits
            .iter()
            .find(|(candidate, hit)| {
                *candidate == key
                    && hit.action == id
                    && hit.row == row
                    && column >= hit.start
                    && column < hit.end
            })
            .cloned()
        {
            if let Some(value) = hit.input {
                self.editor = Some(Editor {
                    key,
                    action: id,
                    value,
                });
            } else {
                self.dispatch(core, &key, id, None).await?;
            }
        }
        Ok(true)
    }

    /// Sends an action to its message-owned execution context.
    async fn dispatch(
        &mut self,
        core: &mut TuiCore,
        key: &SurfaceKey,
        id: String,
        payload: Option<Value>,
    ) -> Result<(), String> {
        let session = self
            .entries
            .get_mut(key)
            .and_then(|entry| entry.session.as_mut())
            .ok_or("Plugin UI instance has closed")?;
        if session.error.is_some() {
            return Err("Plugin UI is in an error state".into());
        }
        session.dispatch(core, id, payload).await
    }

    /// Commits the edited text through the original onValueChange callback.
    pub async fn commit_editor(&mut self, core: &mut TuiCore) -> Result<(), String> {
        let editor = self.editor.take().ok_or("No active plugin input")?;
        self.dispatch(core, &editor.key, editor.action, Some(json!(editor.value)))
            .await
    }

    /// Releases every retained execution lease when leaving the chat or terminal.
    pub async fn clear(&mut self, core: &mut TuiCore) -> Result<(), String> {
        for entry in self.entries.values_mut() {
            if let Some(session) = &mut entry.session {
                session.release(core).await?;
            }
        }
        self.entries.clear();
        self.hits.clear();
        self.pressed = None;
        self.editor = None;
        Ok(())
    }
}

impl OperitTui {
    /// Advances plugin UI state independently of synchronous terminal painting.
    pub(super) async fn sync_compose_surfaces(&mut self) -> Result<(), String> {
        self.compose
            .sync(
                &mut self.core,
                self.current_chat_id_cache.clone(),
                self.current_messages_cache
                    .iter()
                    .map(|message| message.timestamp)
                    .collect(),
                self.transcript_render_cache.xml.clone(),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::i18n::TuiLanguage;
    use super::*;

    /// Builds a mounted test surface without starting a JavaScript engine.
    fn entry(label: &str, id: &str) -> Entry {
        Entry {
            content: String::new(),
            replacement: None,
            error: None,
            session: Some(Session {
                package: "test".into(),
                context: id.into(),
                script: String::new(),
                module: "screen".into(),
                options: BTreeMap::new(),
                error: None,
                stream: None,
                loaded_key: None,
                tree: Some(
                    serde_json::from_value(
                        json!({"type":"Button","props":{"text":label,"onClick":{"__actionId":id}}}),
                    )
                    .unwrap(),
                ),
            }),
        }
    }

    /// Keeps later control coordinates correct when earlier XML blocks change rendered height.
    #[test]
    fn projection_remaps_multiple_surfaces_and_fold_hits() {
        let mut host = ComposeHost::default();
        let first = (1, 0, "one".into());
        let second = (2, 0, "two".into());
        host.entries.insert(first.clone(), entry("First", "a"));
        host.entries.insert(second.clone(), entry("Second", "b"));
        let slots = vec![
            XmlSurfaceSlot {
                key: first.clone(),
                tag: "one".into(),
                content: String::new(),
                lines: 1..4,
            },
            XmlSurfaceSlot {
                key: second.clone(),
                tag: "two".into(),
                content: String::new(),
                lines: 5..7,
            },
        ];
        let mut lines = (0..8).map(|index| Line::from(index.to_string())).collect();
        let mut folds = vec![super::super::fold::TranscriptFoldHit {
            line_index: 7,
            target: super::super::fold::FoldTarget {
                message_timestamp: 3,
                stable_key: "fold".into(),
                expanded: false,
            },
        }];
        host.project(
            &mut lines,
            &slots,
            &mut folds,
            40,
            TuiLanguage::English.text(),
        );
        assert_eq!(lines.len(), 9);
        assert_eq!(folds[0].line_index, 8);
        assert!(host.press(2, 3));
        assert_eq!(host.pressed.as_ref(), Some(&(first, "a".into())));
        assert!(host.press(6, 3));
        assert_eq!(host.pressed.as_ref(), Some(&(second, "b".into())));
        assert!(!host.press(6, 35));
    }
}
