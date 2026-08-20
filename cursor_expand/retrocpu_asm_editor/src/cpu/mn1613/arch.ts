import type { CallingConvention, CpuArchitecture } from "../types";

/** asm-rules.mdc の呼び出し規約（MN1610 / MN1613 共通） */
export const MN1613_CALLING_CONVENTION: CallingConvention = {
	argRegisters: ["R0", "R1", "R2"],
	returnRegisters: ["R0", "R1", "R2"],
	returnRegister: "R0",
	calleeSavedNote:
		"サブルーチン内で R3〜R4 を書き換える場合は、入口で退避し出口で復元する。R0〜R2 は caller-saved（戻り可）。",
	summaryMarkdown: [
		"**呼び出し規約**",
		"",
		"| 役割 | レジスタ / 場所 |",
		"|------|----------------|",
		"| 第1引数 | `R0` |",
		"| 第2引数 | `R1` |",
		"| 第3引数 | `R2` |",
		"| 第4引数以降 | スタック |",
		"| 戻り値 | `R0` / `R1` / `R2`（必要な分） |",
		"",
		"**R0〜R2** は caller-saved（破壊可・戻り可）。**R3〜R4** のみ callee-saved（入口で退避・出口で復元）。",
	].join("\n"),
};

/** MN1610 命令 */
const MN1610_MNEMONICS = [
	"L",
	"ST",
	"B",
	"BAL",
	"IMS",
	"DMS",
	"A",
	"S",
	"C",
	"CB",
	"MV",
	"MVB",
	"BSWP",
	"DSWP",
	"LAD",
	"AND",
	"OR",
	"EOR",
	"SR",
	"SL",
	"SBIT",
	"RBIT",
	"TBIT",
	"AI",
	"SI",
	"LPSW",
	"H",
	"PUSH",
	"POP",
	"RET",
	"RD",
	"WT",
	"MVI",
] as const;

/** MN1613 追加命令 */
const MN1613_EXTRA_MNEMONICS = [
	"LD",
	"STD",
	"LR",
	"STR",
	"MVWR",
	"MVWI",
	"MVBR",
	"BSWR",
	"DSWR",
	"PSHM",
	"POPM",
	"AWR",
	"AWI",
	"SWR",
	"SWI",
	"CWR",
	"CWI",
	"CBR",
	"CBI",
	"NEG",
	"AD",
	"SD",
	"M",
	"D",
	"DAA",
	"DAS",
	"LADR",
	"LADI",
	"ANDR",
	"ANDI",
	"ORR",
	"ORI",
	"EORR",
	"EORI",
	"FA",
	"FS",
	"FM",
	"FD",
	"FIX",
	"FLT",
	"BD",
	"BL",
	"BR",
	"BALD",
	"BALL",
	"BALR",
	"RETL",
	"TSET",
	"TRST",
	"SRBT",
	"DEBP",
	"BLK",
	"RDR",
	"WTR",
	"LB",
	"LS",
	"STB",
	"STS",
	"CPYB",
	"CPYS",
	"CPYH",
	"SETB",
	"SETS",
	"SETH",
] as const;

/** sdas / retrocpu_asm 系ディレクティブ（大文字） */
const ASM_DIRECTIVES = [
	".CPU",
	"CPU",
	".ORG",
	"ORG",
	".EQU",
	"EQU",
	".WORD",
	"WORD",
	"DW",
	".DW",
	".DS",
	"DS",
	".BLKW",
	"BLKW",
	".BLKB",
	"BLKB",
	".AREA",
	"AREA",
	".GLOBL",
	".GLOBAL",
	"GLOBL",
	"GLOBAL",
	".INCLUDE",
	"INCLUDE",
	".MACRO",
	"MACRO",
	".ENDM",
	"ENDM",
	".REPT",
	"REPT",
	".IRP",
	"IRP",
	".IRPC",
	"IRPC",
	".MEXIT",
	"MEXIT",
	".END",
	"END",
] as const;

/** MV / A / AND 等が取る汎用レジスタ（retrocpu_asm `REG_MAP` 相当） */
const MN1610_GPR_REGISTERS = [
	"R0",
	"R1",
	"R2",
	"R3",
	"R4",
	"SP",
	"STR",
	"X0",
	"X1",
] as const;

const MN1610_REGISTERS = MN1610_GPR_REGISTERS;

/** セグメント／OS／特殊／ハード制御レジスタ（CPYB/CPYS/CPYH 系で触る） */
const MN1613_EXTENDED_REGISTERS = [
	"CSBR",
	"SSBR",
	"TSR0",
	"TSR1",
	"OSR0",
	"OSR1",
	"OSR2",
	"OSR3",
	"SBRB",
	"ICB",
	"NPP",
	"TCR",
	"TIR",
	"TSR",
	"SCR",
	"SSR",
	"SOR",
	"IISR",
	"DR0",
] as const;

/** ベース／OS レジスタ（CPYB / SETB / LB / STB の bbb） */
export const MN1613_BBB_REGISTERS = new Set([
	"CSBR",
	"SSBR",
	"TSR0",
	"TSR1",
	"OSR0",
	"OSR1",
	"OSR2",
	"OSR3",
]);

/** LD/STD/LR/STR の BRn（OSR は不可。retrocpu_asm BB_MAP） */
export const MN1613_BB_REGISTERS = new Set(["CSBR", "SSBR", "TSR0", "TSR1"]);

/** 8bit EA（L/ST/B/BAL/IMS/DMS）。インデックスは X0/X1 のみ */
export const MN161X_EA8_MNEMONICS = new Set([
	"L",
	"ST",
	"B",
	"BAL",
	"IMS",
	"DMS",
]);

/** 特殊レジスタ（CPYS / SETS / LS / STS の ppp） */
export const MN1613_PPP_REGISTERS = new Set(["SBRB", "ICB", "NPP"]);

/** ハード制御レジスタ（CPYH / SETH の hhh。TSR はタイマ状態で TSR0/TSR1 とは別） */
export const MN1613_HHH_REGISTERS = new Set([
	"TCR",
	"TIR",
	"TSR",
	"SCR",
	"SSR",
	"SOR",
	"IISR",
]);

/** CPYB/CPYS/CPYH / SETB/SETS/SETH（オペランドはレジスタのみ） */
export const MN1613_COPY_SET_MNEMONICS = new Set([
	"CPYB",
	"CPYS",
	"CPYH",
	"SETB",
	"SETS",
	"SETH",
]);

const MN1613_REGISTERS = [
	...MN1610_REGISTERS,
	...MN1613_EXTENDED_REGISTERS,
] as const;

/**
 * オペランドのレジスタがすべて GPR でなければならない命令。
 * （`L`/`ST` や `CPYB` などベース／特殊レジスタを許すものは含めない）
 */
const MN161X_GPR_ONLY_MNEMONICS = [
	"A",
	"S",
	"C",
	"CB",
	"MV",
	"MVB",
	"BSWP",
	"DSWP",
	"LAD",
	"AND",
	"OR",
	"EOR",
	"SR",
	"SL",
	"SBIT",
	"RBIT",
	"TBIT",
	"AI",
	"SI",
	"PUSH",
	"POP",
	"MVI",
	"MVWI",
	"AWI",
	"SWI",
	"CWI",
	"CBI",
	"NEG",
	"AD",
	"SD",
	"M",
	"D",
	"DAA",
	"DAS",
	"LADI",
	"ANDI",
	"ORI",
	"EORI",
	"FA",
	"FS",
	"FM",
	"FD",
	"FIX",
	"FLT",
	"TSET",
	"TRST",
] as const;

/** 共有拡張子（ステータスバー選択の既定 CPU を使う） */
export const SHARED_ASM_EXTENSIONS = ["asm", "s", "inc", "h"] as const;

/** MN1613 アーキテクチャ定義（MN1610 命令を含む） */
export const mn1613Architecture: CpuArchitecture = {
	id: "mn1613",
	displayName: "MN1613",
	extensions: ["asm", "s", "mn1613", "inc", "h"],
	languageId: "mn1613asm",
	mnemonics: new Set([...MN1610_MNEMONICS, ...MN1613_EXTRA_MNEMONICS]),
	directives: new Set(ASM_DIRECTIVES),
	registers: new Set(MN1613_REGISTERS),
	gprRegisters: new Set(MN1610_GPR_REGISTERS),
	gprOnlyMnemonics: new Set(MN161X_GPR_ONLY_MNEMONICS),
	callMnemonics: new Set(["BAL", "BL", "BALD", "BALL", "BALR"]),
	labelRefMnemonics: new Set([
		"B",
		"BAL",
		"BD",
		"BL",
		"BALD",
		"BALL",
		"BALR",
		"L",
		"ST",
		"LD",
		"STD",
		"IMS",
		"DMS",
	]),
	callingConvention: MN1613_CALLING_CONVENTION,
};
