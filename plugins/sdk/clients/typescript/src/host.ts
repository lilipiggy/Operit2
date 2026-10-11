import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

/** Runs the built-in native platform carrier outside Node's event loop. */
export class PluginSdkHost extends EventEmitter {
  /** Owns the worker carrying this session. */
  private constructor(private readonly worker: Worker) { super(); }

  /** Activates Operit and waits for a ready native session. */
  static connect(nativeLibraryPath = fileURLToPath(new URL('../native/liboperit_plugin_sdk.so', import.meta.url))): Promise<PluginSdkHost> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./host_worker.js', import.meta.url), { workerData: { nativeLibraryPath } });
      const host = new PluginSdkHost(worker);
      let ready = false;
      worker.on('message', (event) => {
        if (event.type === 'ready') { ready = true; resolve(host); }
        if (event.type === 'message') host.emit('message', Buffer.from(event.bytes));
        if (event.type === 'error') {
          const error = new Error(event.error);
          if (ready) host.emit('failure', error); else reject(error);
        }
      });
      worker.on('error', (error) => { if (ready) host.emit('failure', error); else reject(error); });
      worker.on('exit', () => { if (ready) host.emit('closed'); else reject(new Error('Native SDK worker exited before connecting')); });
    });
  }

  /** Queues one envelope on the worker in protocol order. */
  send(bytes: Uint8Array): void { this.worker.postMessage(bytes); }

  /** Closes the native carrier and terminates its worker. */
  close(): void { this.worker.postMessage(null); }
}
