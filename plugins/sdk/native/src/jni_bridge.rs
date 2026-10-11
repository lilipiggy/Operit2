use super::*;
use jni::{
    objects::{JByteArray, JClass, JObject},
    sys::{jbyteArray, jlong},
    JNIEnv,
};

/// Reports the native session error to the JVM caller.
fn throw_error(env: &mut JNIEnv) {
    let message = LAST_ERROR.with(|slot| slot.borrow().to_string_lossy().into_owned());
    let _ = env.throw_new("java/lang/IllegalStateException", message);
}

/// Creates the built-in platform session for JVM SDK clients.
#[no_mangle]
pub extern "system" fn Java_operit_plugin_sdk_OperitPluginSdkHost_connect(
    mut env: JNIEnv,
    _class: JClass,
) -> jlong {
    let handle = operit_sdk_connect();
    if handle == 0 {
        throw_error(&mut env);
    }
    handle as jlong
}

/// Sends one JVM MessagePack envelope.
#[no_mangle]
pub extern "system" fn Java_operit_plugin_sdk_OperitPluginSdkHost_send(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    bytes: JByteArray,
) {
    match env.convert_byte_array(bytes) {
        Ok(bytes) => {
            if unsafe { operit_sdk_send(handle as u64, bytes.as_ptr(), bytes.len()) } != 0 {
                throw_error(&mut env);
            }
        }
        Err(e) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", e.to_string());
        }
    }
}

/// Waits for a JVM envelope with a bounded wait so close can terminate the reader.
#[no_mangle]
pub extern "system" fn Java_operit_plugin_sdk_OperitPluginSdkHost_next(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jbyteArray {
    let mut bytes = std::ptr::null_mut();
    let mut length = 0;
    let status = unsafe { operit_sdk_next(handle as u64, 1000, &mut bytes, &mut length) };
    if status < 0 {
        throw_error(&mut env);
        return std::ptr::null_mut();
    }
    if status == 0 {
        return std::ptr::null_mut();
    }
    let result = env.byte_array_from_slice(unsafe { std::slice::from_raw_parts(bytes, length) });
    unsafe {
        operit_sdk_free(bytes, length);
    }
    match result {
        Ok(array) => array.into_raw(),
        Err(e) => {
            let _ = env.throw_new("java/lang/IllegalStateException", e.to_string());
            std::ptr::null_mut()
        }
    }
}

/// Closes the JVM-owned native session.
#[no_mangle]
pub extern "system" fn Java_operit_plugin_sdk_OperitPluginSdkHost_close(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if operit_sdk_close(handle as u64) != 0 {
        throw_error(&mut env);
    }
}

/// Installs the SDK's Android Activity and Binder client before connecting.
#[no_mangle]
pub extern "system" fn Java_operit_plugin_sdk_OperitPluginSdkHost_installAndroidClient(
    mut env: JNIEnv,
    _class: JClass,
    client: JObject,
) {
    let result = env
        .get_java_vm()
        .and_then(|vm| env.new_global_ref(client).map(|client| (vm, client)));
    match result {
        Ok((vm, client)) => {
            if let Err(e) = operit_plugin_sdk_host::registerAndroidClient(vm, client) {
                let _ = env.throw_new("java/lang/IllegalStateException", e.to_string());
            }
        }
        Err(e) => {
            let _ = env.throw_new("java/lang/IllegalStateException", e.to_string());
        }
    }
}
