use crate::PreferencesDataStore::{
    stringPreferencesKey, Flow, Preferences, PreferencesDataStore, PreferencesDataStoreError,
    PreferencesKey,
};
use crate::RuntimeStorePaths::RuntimeStorePaths;
use operit_model::Workspace::{Workspace, WorkspaceFolder};
use uuid::Uuid;

/// Preference-backed store for named workspaces and their mounted folders.
#[derive(Clone)]
pub struct WorkspacePreferenceStore {
    dataStore: PreferencesDataStore,
}

impl WorkspacePreferenceStore {
    const PREFERENCES_VERSION: u32 = 1;

    /// Creates a workspace preference store from explicit runtime paths.
    pub fn new(paths: RuntimeStorePaths) -> Self {
        Self {
            dataStore: PreferencesDataStore::new(paths.workspaces_preferences_path())
                .withSchema(Self::PREFERENCES_VERSION, Self::migratePreferences),
        }
    }

    /// Creates a workspace preference store from the default runtime paths.
    pub fn getInstance() -> Self {
        Self::new(RuntimeStorePaths::default())
    }

    fn WORKSPACE_LIST() -> PreferencesKey {
        stringPreferencesKey("workspace_list")
    }

    fn workspaceDataKey(workspaceId: &str) -> PreferencesKey {
        stringPreferencesKey(&format!("workspace_{workspaceId}_data"))
    }

    /// Observes every stored workspace ordered by name.
    pub fn allWorkspacesFlow(&self) -> Flow<Vec<Workspace>> {
        self.dataStore.dataFlow().map(|preferences| {
            let mut workspaces = Self::readWorkspaceList(&preferences)
                .into_iter()
                .filter_map(|id| Self::decodeWorkspace(preferences.get(&Self::workspaceDataKey(&id))?))
                .collect::<Vec<_>>();
            workspaces.sort_by(|left, right| {
                left.name
                    .to_lowercase()
                    .cmp(&right.name.to_lowercase())
                    .then_with(|| left.id.cmp(&right.id))
            });
            workspaces
        })
    }

    /// Loads every stored workspace.
    pub fn getAll(&self) -> Result<Vec<Workspace>, PreferencesDataStoreError> {
        self.allWorkspacesFlow().first()
    }

    /// Loads one workspace by id.
    pub fn getById(&self, workspaceId: &str) -> Result<Option<Workspace>, PreferencesDataStoreError> {
        if workspaceId.trim().is_empty() {
            return Ok(None);
        }
        let preferences = self.dataStore.dataFlow().first()?;
        Ok(preferences
            .get(&Self::workspaceDataKey(workspaceId))
            .and_then(|json| Self::decodeWorkspace(json)))
    }

    /// Creates a named workspace with the supplied folders.
    pub fn create(
        &self,
        name: String,
        folders: Vec<WorkspaceFolder>,
    ) -> Result<Workspace, PreferencesDataStoreError> {
        let timestamp = currentTimeMillis();
        let workspace = Workspace {
            id: Uuid::new_v4().to_string(),
            name,
            folders,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        self.upsert(workspace)
    }

    /// Inserts or replaces one workspace record.
    pub fn upsert(&self, workspace: Workspace) -> Result<Workspace, PreferencesDataStoreError> {
        workspace
            .validate()
            .map_err(PreferencesDataStoreError::Message)?;
        let id = workspace.id.clone();
        self.dataStore.try_edit_result(|preferences| {
            let mut currentList = Self::readWorkspaceList(preferences);
            if !currentList.contains(&id) {
                currentList.push(id.clone());
            }
            currentList.sort();
            currentList.dedup();
            Self::writeWorkspaceList(preferences, currentList);
            preferences.set(
                &Self::workspaceDataKey(&id),
                serde_json::to_string(&workspace)
                    .map_err(|error| PreferencesDataStoreError::Message(error.to_string()))?,
            );
            Ok::<(), PreferencesDataStoreError>(())
        })?;
        Ok(workspace)
    }

    /// Deletes one workspace by id.
    pub fn delete(&self, workspaceId: &str) -> Result<(), PreferencesDataStoreError> {
        if workspaceId.trim().is_empty() {
            return Ok(());
        }
        self.dataStore.edit(|preferences| {
            let mut currentList = Self::readWorkspaceList(preferences);
            currentList.retain(|item| item != workspaceId);
            Self::writeWorkspaceList(preferences, currentList);
            preferences.remove(&Self::workspaceDataKey(workspaceId));
        })
    }

    fn decodeWorkspace(json: &str) -> Option<Workspace> {
        let workspace = serde_json::from_str::<Workspace>(json).ok()?;
        workspace.validate().ok()?;
        Some(workspace)
    }

    fn readWorkspaceList(preferences: &Preferences) -> Vec<String> {
        preferences
            .get(&Self::WORKSPACE_LIST())
            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
            .unwrap_or_default()
    }

    fn writeWorkspaceList(preferences: &mut Preferences, workspaceIds: Vec<String>) {
        preferences.set(
            &Self::WORKSPACE_LIST(),
            serde_json::to_string(&workspaceIds).expect("workspace list must serialize"),
        );
    }

    fn migratePreferences(
        version: u32,
        preferences: &mut Preferences,
    ) -> Result<(), PreferencesDataStoreError> {
        match version {
            0 => {
                if preferences.get(&Self::WORKSPACE_LIST()).is_none() {
                    Self::writeWorkspaceList(preferences, Vec::new());
                }
                Ok(())
            }
            from => Err(PreferencesDataStoreError::MissingMigration {
                from,
                to: from + 1,
            }),
        }
    }
}

fn currentTimeMillis() -> i64 {
    operit_host_api::TimeUtils::currentTimeMillis()
}
