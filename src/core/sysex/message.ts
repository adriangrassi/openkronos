// Kronos SysEx envelope F0 42 3g 68 fn payload F7 (KRONOS_MIDI_SysEx.txt, function table L8-66).

export const DEVICE_INQUIRY = Uint8Array.from([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);

export const Fn = {
  objectDumpRequest: 0x72,
  objectDump: 0x73,
  storeBankRequest: 0x76,
  dumpBankRequest: 0x77,
  currentObjectDumpRequest: 0x74,
  currentObjectDump: 0x75,
  bankDigestRequest: 0x37,
  bankDigest: 0x38,
  bankDigestCollectionRequest: 0x39,
  bankDigestCollection: 0x3a,
  currentSampleInfoRequest: 0x30,
  currentSampleInfo: 0x31,
  currentPerformanceIdRequest: 0x32,
  currentPerformanceId: 0x33,
  currentPianoTypesRequest: 0x34,
  currentPianoTypes: 0x35,
  notifyPianoTypesChanged: 0x36,
  smfDataDumpRequest: 0x79,
  smfDataDump: 0x7a,
  parameterChangeInteger: 0x43,
  parameterChangeBinary: 0x44,
  sequencerParameterChange: 0x41,
  karmaParameterChange: 0x6d,
  drumTrackParameterChange: 0x6e,
  setCurrentObject: 0x71,
  drumKitParameterInteger: 0x53,
  drumKitParameterBinary: 0x54,
  waveSeqParameterInteger: 0x55,
  waveSeqParameterBinary: 0x56,
  modeRequest: 0x12,
  modeData: 0x42,
  editInContextNotify: 0x48,
  modeChange: 0x4e,
  programBankTypesRequest: 0x60,
  programBankTypes: 0x61,
  changeProgramBankType: 0x7c,
  queryProgramBankType: 0x7d,
  queryProgramBankTypeReply: 0x7e,
  resetController: 0x78,
  karmaControl: 0x7f,
  songSelect: 0x13,
  reply: 0x24,
} as const;

export function buildKorg(channel: number, fn: number, payload: ArrayLike<number>): Uint8Array {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new RangeError(`channel ${channel}`);
  if (!Number.isInteger(fn) || fn < 0 || fn > 0x7f) throw new RangeError(`function ${fn}`);
  const out = new Uint8Array(6 + payload.length);
  out.set([0xf0, 0x42, 0x30 | channel, 0x68, fn], 0);
  for (let i = 0; i < payload.length; i++) {
    const b = payload[i];
    if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new RangeError(`payload byte ${i} is not 7-bit: ${b}`);
    out[5 + i] = b;
  }
  out[out.length - 1] = 0xf7;
  return out;
}

export function parseKorg(msg: Uint8Array): { channel: number; fn: number; payload: Uint8Array } | null {
  if (msg.length < 6 || msg[0] !== 0xf0 || msg[msg.length - 1] !== 0xf7) return null;
  if (msg[1] !== 0x42 || (msg[2] & 0xf0) !== 0x30 || msg[3] !== 0x68) return null;
  const payload = msg.slice(5, -1);
  // A byte above 7F inside the frame means a second message or a truncated one.
  if (msg[4] > 0x7f || payload.some((b) => b > 0x7f)) return null;
  return { channel: msg[2] & 0x0f, fn: msg[4], payload };
}

export interface DeviceInquiryReply {
  channel: number;
  manufacturer: number;
  family: number;
  member: number;
  version: number[];
}

export function parseDeviceInquiryReply(msg: Uint8Array): DeviceInquiryReply | null {
  // F0 7E dev 06 02 mfr famLSB famMSB memLSB memMSB v1 v2 v3 v4 F7
  if (msg.length !== 15 || msg[0] !== 0xf0 || msg[1] !== 0x7e || msg[3] !== 0x06 || msg[4] !== 0x02 || msg[14] !== 0xf7) return null;
  for (let i = 2; i < 14; i++) if (msg[i] > 0x7f) return null;
  return {
    channel: msg[2],
    manufacturer: msg[5],
    family: msg[6] | (msg[7] << 7),
    member: msg[8] | (msg[9] << 7),
    version: [msg[10], msg[11], msg[12], msg[13]],
  };
}
