use super::*;
use crate::sync::SqlChatSyncStore::tests::{openTestStore, DATABASE_MUTEX};

/// Creates a valid workspace with an exact record identity and VFS root.
fn workspaceFixture(id: &str, name: &str) -> Workspace {
    Workspace {
        id: id.to_string(),
        name: name.to_string(),
        folders: vec![WorkspaceFolder {
            name: name.to_string(),
            path: format!("/app/workspaces/{name}"),
        }],
        createdAt: 1,
        updatedAt: 1,
    }
}

/// Keeps independently synchronized records visible despite a stale shared index.
#[test]
fn workspace_records_are_visible_when_the_legacy_index_omits_their_ids() {
    let _guard = DATABASE_MUTEX.lock().unwrap();
    let (paths, _, _) = openTestStore("workspace-stale-index");
    let store = WorkspacePreferenceStore::new(paths);
    let first = workspaceFixture("workspace-test", "Test");
    let second = workspaceFixture("workspace-other", "Other");
    store.upsert(first.clone()).unwrap();
    store.upsert(second.clone()).unwrap();
    store
        .dataStore
        .edit(|preferences| {
            preferences.set(
                &stringPreferencesKey("workspace_list"),
                "[\"missing-record\",\"workspace-other\"]".to_string(),
            );
        })
        .unwrap();

    assert_eq!(store.getById(&first.id).unwrap(), Some(first.clone()));
    assert_eq!(store.getAll().unwrap(), vec![second.clone(), first.clone()]);
    assert_eq!(
        store.allWorkspacesFlow().first().unwrap(),
        vec![second.clone(), first.clone()]
    );
    assert_eq!(store.getById("missing-record").unwrap(), None);

    store
        .dataStore
        .edit(|preferences| {
            preferences.set(&stringPreferencesKey("workspace_list"), "[]".to_string());
        })
        .unwrap();
    assert_eq!(store.getAll().unwrap(), vec![second, first]);
}

/// Writes and removes only per-workspace records so concurrent catalogs cannot lose membership.
#[test]
fn workspace_upserts_and_deletes_do_not_write_a_shared_index() {
    let _guard = DATABASE_MUTEX.lock().unwrap();
    let (paths, _, _) = openTestStore("workspace-independent-records");
    let store = WorkspacePreferenceStore::new(paths);
    let first = workspaceFixture("workspace-a", "A");
    let second = workspaceFixture("workspace-b", "B");
    store.upsert(first.clone()).unwrap();
    store.upsert(second.clone()).unwrap();
    assert_eq!(store.getAll().unwrap(), vec![first.clone(), second.clone()]);
    assert_eq!(
        store
            .dataStore
            .dataFlow()
            .first()
            .unwrap()
            .get(&stringPreferencesKey("workspace_list")),
        None,
    );

    store.delete(&first.id).unwrap();
    assert_eq!(store.getById(&first.id).unwrap(), None);
    assert_eq!(store.getAll().unwrap(), vec![second]);
    assert_eq!(
        store
            .dataStore
            .dataFlow()
            .first()
            .unwrap()
            .get(&stringPreferencesKey("workspace_list")),
        None,
    );
}

/// Reports malformed records instead of hiding them as absent workspace metadata.
#[test]
fn invalid_workspace_records_are_errors_for_both_catalog_and_id_reads() {
    let _guard = DATABASE_MUTEX.lock().unwrap();
    let (paths, _, _) = openTestStore("workspace-invalid-records");
    let store = WorkspacePreferenceStore::new(paths);
    let workspace = workspaceFixture("workspace-valid", "Valid");
    for json in [
        "{".to_string(),
        serde_json::to_string(&workspace).unwrap(),
        serde_json::to_string(&Workspace {
            folders: Vec::new(),
            ..workspace.clone()
        })
        .unwrap(),
    ] {
        store
            .dataStore
            .edit(|preferences| {
                preferences.set(
                    &WorkspacePreferenceStore::workspaceDataKey("workspace-invalid"),
                    json.clone(),
                );
            })
            .unwrap();
        assert!(store.getById("workspace-invalid").is_err());
        assert!(store.getAll().is_err());
        assert!(store.allWorkspacesFlow().first().is_err());
    }
}
