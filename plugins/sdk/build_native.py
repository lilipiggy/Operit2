"""Build and stage the SDK-owned native carrier for language packages."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

SDK = Path(__file__).resolve().parent
ANDROID_ABIS = {
    "aarch64-linux-android": "arm64-v8a",
    "armv7-linux-androideabi": "armeabi-v7a",
    "x86_64-linux-android": "x86_64",
}


def main() -> None:
    """Build one explicitly selected Rust target and stage its native SDK artifacts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()
    target = args.target
    parts = target.split("-")
    if target in ANDROID_ABIS or parts[2] == "linux":
        filename = "liboperit_plugin_sdk.so"
    elif parts[2] == "windows":
        filename = "operit_plugin_sdk.dll"
    elif parts[2] in ("darwin", "ios"):
        filename = "liboperit_plugin_sdk.dylib"
    else:
        raise ValueError(f"Unsupported SDK target: {target}")
    if not args.no_build:
        environment = dict(os.environ)
        environment["RUSTFLAGS"] = "-Awarnings"
        subprocess.run(["cargo", "build", "--manifest-path", str(SDK / "native/Cargo.toml"), "--target-dir", str(SDK / "native/target"), "--release", "--target", target], check=True, env=environment)
    source = SDK / "native/target" / target / "release" / filename
    if not source.is_file():
        raise FileNotFoundError(source)
    if target in ANDROID_ABIS:
        abi = ANDROID_ABIS[target]
        destinations = [
            SDK / "clients/dart/android/src/main/jniLibs" / abi / filename,
            SDK / "clients/kotlin/src/android/jniLibs" / abi / filename,
        ]
    else:
        destinations = [
            SDK / "clients/typescript/native/liboperit_plugin_sdk.so",
            SDK / "clients/dart/native/liboperit_plugin_sdk.so",
            SDK / "clients/kotlin/native" / filename,
        ]
    for destination in destinations:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        print(destination)


if __name__ == "__main__":
    main()
