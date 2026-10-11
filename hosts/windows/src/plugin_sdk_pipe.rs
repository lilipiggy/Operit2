use std::fs::File;
use std::io::{self, Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows_sys::Win32::System::Pipes::ConnectNamedPipe;
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

/// Owns an event and a stable OVERLAPPED structure until the kernel completes I/O.
struct Operation {
    event: OwnedHandle,
    overlapped: Box<OVERLAPPED>,
}

impl Operation {
    /// Allocates one manual-reset event for a single pipe operation.
    fn new() -> io::Result<Self> {
        let handle = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let event = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut overlapped: Box<OVERLAPPED> = Box::new(unsafe { std::mem::zeroed() });
        overlapped.hEvent = handle;
        Ok(Self { event, overlapped })
    }

    /// Waits for completion, cancelling closed sessions before releasing kernel buffers.
    fn finish(&mut self, file: HANDLE, closed: &AtomicBool) -> io::Result<usize> {
        let mut transferred = 0;
        loop {
            let status = unsafe { WaitForSingleObject(self.event.as_raw_handle() as HANDLE, 25) };
            if status == WAIT_OBJECT_0 {
                break;
            }
            if status != WAIT_TIMEOUT || closed.load(Ordering::SeqCst) {
                let error = if status == WAIT_TIMEOUT {
                    io::Error::new(io::ErrorKind::Interrupted, "Plugin SDK pipe closed")
                } else {
                    io::Error::last_os_error()
                };
                unsafe {
                    CancelIoEx(file, &*self.overlapped);
                    GetOverlappedResult(file, &*self.overlapped, &mut transferred, 1);
                }
                return Err(error);
            }
        }
        if unsafe { GetOverlappedResult(file, &*self.overlapped, &mut transferred, 0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(transferred as usize)
    }
}

/// Performs independent overlapped reads and writes on a duplex named pipe.
pub(super) struct PipeIo {
    file: File,
    closed: Arc<AtomicBool>,
}

impl PipeIo {
    /// Associates a pipe handle with its session cancellation flag.
    pub(super) fn new(file: File, closed: Arc<AtomicBool>) -> Self {
        Self { file, closed }
    }
}

impl Read for PipeIo {
    /// Reads one chunk without serializing against the pipe's outstanding writes.
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if self.closed.load(Ordering::SeqCst) {
            return Ok(0);
        }
        let mut operation = Operation::new()?;
        let handle = self.file.as_raw_handle() as HANDLE;
        let ok = unsafe {
            ReadFile(
                handle,
                bytes.as_mut_ptr(),
                bytes.len().min(u32::MAX as usize) as u32,
                std::ptr::null_mut(),
                &mut *operation.overlapped,
            )
        };
        if ok == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
            return Err(io::Error::last_os_error());
        }
        operation.finish(handle, &self.closed)
    }
}

impl Write for PipeIo {
    /// Writes a chunk concurrently with the pipe's receive operation.
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Plugin SDK pipe closed",
            ));
        }
        let mut operation = Operation::new()?;
        let handle = self.file.as_raw_handle() as HANDLE;
        let ok = unsafe {
            WriteFile(
                handle,
                bytes.as_ptr(),
                bytes.len().min(u32::MAX as usize) as u32,
                std::ptr::null_mut(),
                &mut *operation.overlapped,
            )
        };
        if ok == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
            return Err(io::Error::last_os_error());
        }
        operation.finish(handle, &self.closed)
    }

    /// Completes local framing; each preceding write already awaited kernel completion.
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Accepts one overlapped pipe connection while observing listener cancellation.
pub(super) fn accept(file: &File, stopped: &AtomicBool) -> io::Result<()> {
    let mut operation = Operation::new()?;
    let handle = file.as_raw_handle() as HANDLE;
    let ok = unsafe { ConnectNamedPipe(handle, &mut *operation.overlapped) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_PIPE_CONNECTED {
            return Ok(());
        }
        if error != ERROR_IO_PENDING {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
    }
    operation.finish(handle, stopped).map(|_| ())
}
