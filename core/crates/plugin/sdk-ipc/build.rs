/// Tracks source changes for the protocol crate without generating a second API.
fn main() {
    println!("cargo:rerun-if-changed=src");
}
