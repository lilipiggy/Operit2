import { parentPort, workerData } from 'node:worker_threads';
import koffi from 'koffi';

const port = parentPort;
if (!port) throw new Error('Plugin SDK host must run in its worker');

try {
  const library = koffi.load(workerData.nativeLibraryPath);
  const connect = library.func('uint64_t operit_sdk_connect()');
  const send = library.func('int operit_sdk_send(uint64_t handle, const uint8_t *bytes, size_t length)');
  const next = library.func('int operit_sdk_next(uint64_t handle, uint32_t timeout_ms, _Out_ uint8_t **bytes, _Out_ size_t *length)');
  const free = library.func('void operit_sdk_free(uint8_t *bytes, size_t length)');
  const close = library.func('int operit_sdk_close(uint64_t handle)');
  const error = library.func('const char *operit_sdk_error()');
  const handle = connect();
  if (handle === 0 || handle === 0n) throw new Error(error());
  let closed = false;
  let timer: ReturnType<typeof setInterval>;

  /** Releases the native session and reports its final state. */
  const finish = (failure?: Error): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    const status = close(handle);
    if (failure) port.postMessage({ type: 'error', error: failure.message });
    else if (status < 0) port.postMessage({ type: 'error', error: error() });
    port.close();
  };
  port.on('message', (bytes: Uint8Array | null) => {
    if (closed) return;
    if (bytes === null) { finish(); return; }
    try { if (send(handle, bytes, bytes.length) < 0) finish(new Error(error())); }
    catch (failure) { finish(failure as Error); }
  });
  timer = setInterval(() => {
    try {
      for (let count = 0; count < 64; count++) {
        const bytes = [null];
        const length = [0];
        const status = next(handle, 0, bytes, length);
        if (status === 0) return;
        if (status < 0) { finish(new Error(error())); return; }
        try { port.postMessage({ type: 'message', bytes: Buffer.from(koffi.decode(bytes[0], koffi.array('uint8_t', length[0]))) }); }
        finally { free(bytes[0], length[0]); }
      }
    } catch (failure) { finish(failure as Error); }
  }, 10);
  port.postMessage({ type: 'ready' });
} catch (failure) {
  port.postMessage({ type: 'error', error: (failure as Error).message });
  port.close();
}
