use std::sync::{Mutex, OnceLock};

use operit_plugin_sdk::toolpkg::ToolPkgPackageModels::ToolPkgChatComposerSlot;
use operit_plugin_sdk::toolpkg::ToolPkgParser::ToolPkgContainerRuntime;

use crate::plugins::toolpkg::ToolPkgHookBridgeSupport::ToolPkgBridgeRuntime;

static CHAT_COMPOSER_SLOTS: OnceLock<Mutex<Vec<ToolPkgChatComposerSlot>>> = OnceLock::new();

/// Exposes the host-composed chat composer extensions to every chat surface.
pub struct ToolPkgChatComposerSlotBridge {
    runtime: ToolPkgBridgeRuntime,
}

impl ToolPkgChatComposerSlotBridge {
    /// Creates a composer-slot bridge for one application runtime.
    pub fn new(runtime: ToolPkgBridgeRuntime) -> Self {
        Self { runtime }
    }

    /// Registers refresh handling for active ToolPkg container changes.
    pub fn register(runtime: ToolPkgBridgeRuntime) {
        let manager = runtime.package_manager();
        manager.addToolPkgRuntimeChangeListener(std::sync::Arc::new(|active_containers| {
            Self::syncToolPkgRegistrations(active_containers);
        }));
    }

    /// Rebuilds the host-owned slot composition from enabled ToolPkg containers.
    #[allow(non_snake_case)]
    pub fn syncToolPkgRegistrations(active_containers: Vec<ToolPkgContainerRuntime>) {
        let mut contributions = active_containers
            .into_iter()
            .flat_map(|container| {
                let container_runtime = container.clone();
                container
                    .chatComposerSlots
                    .into_iter()
                    .map(move |contribution| ToolPkgChatComposerSlot {
                        containerRuntime: container_runtime.clone(),
                        containerPackageName: container.packageName.clone(),
                        contributionId: contribution.id,
                        slot: contribution.slot,
                        screen: contribution.screen,
                        order: contribution.order,
                        keepAlive: contribution.keepAlive,
                    })
            })
            .collect::<Vec<_>>();
        contributions.sort_by(|left, right| {
            left.order
                .cmp(&right.order)
                .then_with(|| left.containerPackageName.cmp(&right.containerPackageName))
                .then_with(|| left.contributionId.cmp(&right.contributionId))
        });
        *CHAT_COMPOSER_SLOTS
            .get_or_init(|| Mutex::new(Vec::new()))
            .lock()
            .expect("toolpkg chat composer slot mutex poisoned") = contributions;
    }

    /// Returns the host-composed contributions registered for one named slot.
    #[allow(non_snake_case)]
    pub fn createSlotDefinitions(&self, slot: String) -> Vec<ToolPkgChatComposerSlot> {
        let normalized_slot = slot.trim().to_ascii_lowercase();
        CHAT_COMPOSER_SLOTS
            .get_or_init(|| Mutex::new(Vec::new()))
            .lock()
            .expect("toolpkg chat composer slot mutex poisoned")
            .iter()
            .filter(|contribution| contribution.slot == normalized_slot)
            .cloned()
            .collect()
    }
}
