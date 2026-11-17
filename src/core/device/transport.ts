export interface MidiTransport {
  send(msg: Uint8Array): void;
  onMessage(cb: (msg: Uint8Array) => void): () => void;
  close(): void;
}
