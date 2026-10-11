//! Minimal ABI for Dart's thread-safe NativeApi.postCObject entry point.
//! Layouts follow dart_native_api.h; typed data is copied by the VM before return.

use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct TypedData {
    kind: i32,
    length: isize,
    values: *const u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ExternalTypedData {
    kind: i32,
    length: isize,
    data: *mut u8,
    peer: *mut c_void,
    callback: unsafe extern "C" fn(*mut c_void, *mut c_void),
}

#[repr(C)]
union ObjectValue {
    typed_data: TypedData,
    external_typed_data: ExternalTypedData,
    integer: i64,
    double: f64,
}

#[repr(C)]
pub struct DartObject {
    kind: i32,
    value: ObjectValue,
}

pub type PostCObject = unsafe extern "C" fn(i64, *mut DartObject) -> bool;

#[derive(Clone, Copy)]
pub struct DartPort {
    post: PostCObject,
    id: i64,
}

impl DartPort {
    /// Binds a VM-provided post function to a Dart SendPort's native identifier.
    pub fn new(post: PostCObject, id: i64) -> Self {
        Self { post, id }
    }

    /// Copies one message into the VM and reports whether its port is still open.
    pub fn send(self, bytes: &[u8]) -> bool {
        let mut message = DartObject {
            kind: 7, // Dart_CObject_kTypedData
            value: ObjectValue {
                typed_data: TypedData {
                    kind: 2, // Dart_TypedData_kUint8
                    length: bytes.len() as isize,
                    values: bytes.as_ptr(),
                },
            },
        };
        unsafe { (self.post)(self.id, &mut message) }
    }
}
