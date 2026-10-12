import { describe, expect, it } from "vite-plus/test";

import { avccWithoutReordering } from "./avcReorder.ts";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

// avcC records captured from serve-sim streaming an iOS 27 iPhone 17 Simulator.
const WITHOUT_VUI = "01640033ffe1000c27640033ac56804c0149e6a401000428ee3cb0";
const WITH_DPB_HINT = "01640033ffe1001627640033ac13143c04c0149e6a9a81010103c20108f801000428ee3cb0";

describe("avccWithoutReordering", () => {
  it("adds a zero-reorder bitstream restriction to an SPS without VUI", () => {
    // VUI with only bitstream_restriction: max_num_reorder_frames 0, max_dec_frame_buffering 1.
    expect(hex(avccWithoutReordering(fromHex(WITHOUT_VUI)))).toBe(
      "01640033ffe1001127640033ac56804c0149e6a806d044235001000428ee3cb0",
    );
  });

  it("replaces an existing restriction and keeps the PPS", () => {
    const rewritten = hex(avccWithoutReordering(fromHex(WITH_DPB_HINT)));
    expect(rewritten).toBe(
      "01640033ffe1001727640033ac13143c04c0149e6a9a810101036822118f8001000428ee3cb0",
    );
    expect(rewritten.endsWith("01000428ee3cb0")).toBe(true);
  });

  it("is stable when applied twice", () => {
    const once = avccWithoutReordering(fromHex(WITHOUT_VUI));
    expect(hex(avccWithoutReordering(once))).toBe(hex(once));
  });

  it("returns records it cannot parse unchanged", () => {
    const truncated = fromHex("01640033ffe1000c2764");
    expect(avccWithoutReordering(truncated)).toBe(truncated);
  });
});
