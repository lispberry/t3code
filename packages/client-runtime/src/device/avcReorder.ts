/**
 * Low-latency H.264 for WebCodecs.
 *
 * serve-sim's encoder never reorders frames, but its High-profile SPS omits
 * the VUI `bitstream_restriction` that says so. Without it, Chromium's
 * VideoToolbox decoder assumes the worst and holds a full DPB (14 frames at
 * the simulator's resolution) before emitting anything, so every tap shows
 * up hundreds of milliseconds late and the end of an animation stalls until
 * the screen changes again. Rewriting the SPS in the avcC description to
 * declare `max_num_reorder_frames = 0` makes the decoder output each frame as
 * soon as it is decoded.
 */

class BitReader {
  private bit = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get position() {
    return this.bit;
  }
  u(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.bytes[this.bit >> 3];
      if (byte === undefined) throw new RangeError("SPS ended early");
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return value;
  }
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) {
      if (++zeros > 31) throw new RangeError("Invalid Exp-Golomb code");
    }
    return 2 ** zeros - 1 + this.u(zeros);
  }
  se(): number {
    const code = this.ue();
    return code % 2 === 1 ? (code + 1) / 2 : -code / 2;
  }
}

class BitWriter {
  private readonly bits: number[] = [];
  u(count: number, value: number) {
    for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
  }
  ue(value: number) {
    const code = value + 1;
    const length = Math.floor(Math.log2(code));
    this.u(length, 0);
    this.u(length + 1, code);
  }
  copy(source: Uint8Array, from: number, to: number) {
    for (let bit = from; bit < to; bit++)
      this.bits.push((source[bit >> 3]! >> (7 - (bit & 7))) & 1);
  }
  /** rbsp_trailing_bits: a stop bit, then zero padding to a byte boundary. */
  finish(): Uint8Array {
    this.bits.push(1);
    while (this.bits.length % 8 !== 0) this.bits.push(0);
    const out = new Uint8Array(this.bits.length / 8);
    for (let i = 0; i < this.bits.length; i++)
      out[i >> 3] = out[i >> 3]! | (this.bits[i]! << (7 - (i & 7)));
    return out;
  }
}

function toRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]!);
  }
  return Uint8Array.from(out);
}

function toNal(rbsp: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(reader: BitReader, size: number) {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + reader.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

function skipHrd(reader: BitReader) {
  const cpbCount = reader.ue() + 1;
  reader.u(8); // bit_rate_scale, cpb_size_scale
  for (let i = 0; i < cpbCount; i++) {
    reader.ue();
    reader.ue();
    reader.u(1);
  }
  reader.u(20); // four 5-bit length fields
}

/** Rewrite one SPS NAL (header byte included) to declare no frame reordering. */
export function spsWithoutReordering(nal: Uint8Array): Uint8Array {
  const rbsp = toRbsp(nal);
  const reader = new BitReader(rbsp);
  reader.u(8); // NAL header
  const profile = reader.u(8);
  reader.u(16); // constraint flags, level
  reader.ue();
  if (HIGH_PROFILES.has(profile)) {
    const chromaFormat = reader.ue();
    if (chromaFormat === 3) reader.u(1);
    reader.ue();
    reader.ue();
    reader.u(1);
    if (reader.u(1)) {
      const lists = chromaFormat === 3 ? 12 : 8;
      for (let i = 0; i < lists; i++) if (reader.u(1)) skipScalingList(reader, i < 6 ? 16 : 64);
    }
  }
  reader.ue();
  const pocType = reader.ue();
  if (pocType === 0) reader.ue();
  else if (pocType === 1) {
    reader.u(1);
    reader.se();
    reader.se();
    const cycle = reader.ue();
    for (let i = 0; i < cycle; i++) reader.se();
  }
  const maxRefFrames = reader.ue();
  reader.u(1);
  reader.ue();
  reader.ue();
  if (!reader.u(1)) reader.u(1);
  reader.u(1);
  if (reader.u(1)) for (let i = 0; i < 4; i++) reader.ue();

  const writer = new BitWriter();
  const vuiFlagAt = reader.position;
  if (!reader.u(1)) {
    writer.copy(rbsp, 0, vuiFlagAt);
    writer.u(1, 1); // vui_parameters_present_flag
    // No aspect ratio, overscan, video signal, chroma location, timing, HRD, or pic_struct.
    writer.u(8, 0);
  } else {
    if (reader.u(1) && reader.u(8) === 255) reader.u(32);
    if (reader.u(1)) reader.u(1);
    if (reader.u(1)) {
      reader.u(4);
      if (reader.u(1)) reader.u(24);
    }
    if (reader.u(1)) {
      reader.ue();
      reader.ue();
    }
    if (reader.u(1)) reader.u(65);
    const nalHrd = reader.u(1);
    if (nalHrd) skipHrd(reader);
    const vclHrd = reader.u(1);
    if (vclHrd) skipHrd(reader);
    if (nalHrd || vclHrd) reader.u(1);
    reader.u(1); // pic_struct_present_flag
    writer.copy(rbsp, 0, reader.position);
  }
  writer.u(1, 1); // bitstream_restriction_flag
  writer.u(1, 1); // motion_vectors_over_pic_boundaries_flag
  writer.ue(2); // max_bytes_per_pic_denom
  writer.ue(1); // max_bits_per_mb_denom
  writer.ue(16); // log2_max_mv_length_horizontal
  writer.ue(16); // log2_max_mv_length_vertical
  writer.ue(0); // max_num_reorder_frames
  writer.ue(Math.max(1, maxRefFrames)); // max_dec_frame_buffering
  return toNal(writer.finish());
}

/**
 * Return the avcC record with every SPS rewritten by `spsWithoutReordering`.
 * Anything it cannot parse is returned unchanged, so the worst case is the
 * original latency, never a broken stream.
 */
export function avccWithoutReordering(avcc: Uint8Array): Uint8Array {
  try {
    if (avcc.length < 7 || avcc[0] !== 1) return avcc;
    const parts: Uint8Array[] = [avcc.subarray(0, 6)];
    const spsCount = avcc[5]! & 0x1f;
    let offset = 6;
    for (let i = 0; i < spsCount; i++) {
      const length = (avcc[offset]! << 8) | avcc[offset + 1]!;
      const end = offset + 2 + length;
      if (end > avcc.length) return avcc;
      const sps = spsWithoutReordering(avcc.subarray(offset + 2, end));
      parts.push(Uint8Array.of(sps.length >> 8, sps.length & 0xff), sps);
      offset = end;
    }
    parts.push(avcc.subarray(offset));
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  } catch {
    return avcc;
  }
}
