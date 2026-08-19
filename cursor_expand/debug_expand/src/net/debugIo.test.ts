/**
 * DebugIoClient のフレーム組み立て試験
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { encodeMemReadFrame } from "./debugIo";

describe("encodeMemReadFrame", () => {
  test("83h + バイトアドレスとバイト数を BE で載せる", () => {
    const f = encodeMemReadFrame(0x00003000, 0x2000);
    assert.equal(f.length, 9);
    assert.equal(f[0], 0x83);
    assert.equal(f[1], 0);
    assert.equal(f[2], 0);
    assert.equal(f[3], 0x30);
    assert.equal(f[4], 0x00);
    assert.equal(f[5], 0);
    assert.equal(f[6], 0);
    assert.equal(f[7], 0x20);
    assert.equal(f[8], 0x00);
  });
});
