# retrocpu_test_framework

MN1613 アセンブラを **TypeScript からアセンブル／リンクし、Intel HEX + CDB をエミュレータで検証**するテストフレームワーク。

仕様: `.cursor/rules/test_framework.mdc`

ドライバ `.asm` は使わない。呼び出し規約は **第1引数=`R0` / 第2引数=`R1` / 第3引数以降=スタック**。

## テストの書き方

Intel HEX・CDB・初期化ラベル（`gl_main`）をテストコードに書く。各ケースで `gl_main` を HALT まで走らせてから `call` する。

```ts
const HEX_FILE = path.join(FRAMEWORK_BUILD, "bios_timer.ihx");
const CDB_FILE = path.join(FRAMEWORK_BUILD, "bios_timer.cdb");
const INIT_LABEL = "gl_main";

beforeAll(() => {
  assembleToHexCdb({ sources: MONITOR_SOURCES, hexFile: HEX_FILE, cdbFile: CDB_FILE });
});

beforeEach(async () => {
  session = createMn1613AsmSession({ hexFile: HEX_FILE, cdbFile: CDB_FILE, initLabel: INIT_LABEL });
  mock = attachHandshakeMock({ syncIrq2: false });
  await session.runInit();
});

await session.call("gl_bios_timer_set", {
  registers: { R0: 1, R1: 100, R2: 0x2222, R3: 0x3333, R4: 0x4444 },
  stack: [3],
});
session.expectRegisters({ R0: 0x00, R2: 0x2222 });
```

## 実行

```bash
cd retrocpu_test_framework
npm install
npm test
```
