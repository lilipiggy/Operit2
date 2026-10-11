use std::path::PathBuf;
use operit_proxy_scan::{scan_core_proxy, CoreProxyScanConfig};

/// Regenerates only the public SDK clients from the canonical route scanner.
fn main() {
    std::env::set_var("CARGO_CFG_TARGET_ARCH", std::env::consts::ARCH);
    std::env::set_var("CARGO_CFG_TARGET_OS", std::env::consts::OS);
    std::env::set_var("CARGO_CFG_TARGET_FAMILY", std::env::consts::FAMILY);
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let scan = scan_core_proxy(CoreProxyScanConfig::from_proxy_manifest_dir(root.join("core/crates/proxy/local")));
    operit_plugin_sdk_codegen::generate_plugin_sdk_client_bindings(&scan.objects, &scan.serializable_type_definitions, &root.join("plugins/sdk/clients")).expect("SDK client generation failed");
}
