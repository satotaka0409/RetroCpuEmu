import type { CallingConvention, CpuArchitecture } from "../types";
import { SHARED_ASM_EXTENSIONS } from "../mn1613/arch";

/** TMS9995 呼び出し規約（ワークスペース / BL） */
export const TMS9995_CALLING_CONVENTION: CallingConvention = {
	argRegisters: ["R1", "R2"],
	returnRegisters: ["R1"],
	returnRegister: "R1",
	calleeSavedNote:
		"BL は戻りアドレスを R11 に保存する。R13–R15 は BLWP / 割り込みコンテキスト用。",
	summaryMarkdown: [
		"**TMS9995 呼び出し規約（慣用）**",
		"",
		"| 役割 | レジスタ |",
		"|------|---------|",
		"| 第1引数 | `R1`（慣用） |",
		"| 第2引数 | `R2` |",
		"| 戻り値 | `R1` |",
		"| BL 戻り | `R11` |",
		"| BLWP 退避 | `R13` WP / `R14` PC / `R15` ST |",
		"",
		"`BL label` で呼び出し、`RT`（`B (R11)`）または `B (R11)` で復帰。",
	].join("\n"),
};

/** retrocpu_asm 全命令（TMS9995_instruction.mdc） */
const TMS9995_MNEMONICS = [
	"SZC",
	"SZCB",
	"S",
	"SB",
	"C",
	"CB",
	"A",
	"AB",
	"MOV",
	"MOVB",
	"SOC",
	"SOCB",
	"JMP",
	"JLT",
	"JLE",
	"JEQ",
	"JHE",
	"JGT",
	"JNE",
	"JNC",
	"JOC",
	"JNO",
	"JL",
	"JH",
	"JOP",
	"SBO",
	"SBZ",
	"TB",
	"COC",
	"CZC",
	"XOR",
	"XOP",
	"LDCR",
	"STCR",
	"MPY",
	"DIV",
	"SRA",
	"SRL",
	"SLA",
	"SRC",
	"BLWP",
	"B",
	"X",
	"CLR",
	"NEG",
	"INV",
	"INC",
	"INCT",
	"DEC",
	"DECT",
	"BL",
	"SWPB",
	"SETO",
	"ABS",
	"DIVS",
	"MPYS",
	"LI",
	"AI",
	"ANDI",
	"ORI",
	"CI",
	"LWPI",
	"LIMI",
	"STWP",
	"STST",
	"LST",
	"LWP",
	"RTWP",
	"RT",
	"IDLE",
	"RSET",
	"CKON",
	"CKOF",
	"LREX",
	"NOP",
] as const;

/** Format 1（src, dst とも汎用アドレス） */
export const TMS9995_FMT1 = new Set([
	"SZC",
	"SZCB",
	"S",
	"SB",
	"C",
	"CB",
	"A",
	"AB",
	"MOV",
	"MOVB",
	"SOC",
	"SOCB",
]);

/** Format 2 条件ジャンプ（ラベル／アドレス。相対は次命令基準） */
export const TMS9995_FMT2_JUMP = new Set([
	"JMP",
	"JLT",
	"JLE",
	"JEQ",
	"JHE",
	"JGT",
	"JNE",
	"JNC",
	"JOC",
	"JNO",
	"JL",
	"JH",
	"JOP",
]);

/** Format 2 CRU 1bit（`#disp`、R12 相対） */
export const TMS9995_FMT2_CRU = new Set(["SBO", "SBZ", "TB"]);

/** Format 3（src, Rn） */
export const TMS9995_FMT3 = new Set(["COC", "CZC", "XOR"]);

/** Format 4（addr, #bits） */
export const TMS9995_FMT4 = new Set(["LDCR", "STCR"]);

/** Format 5（Rn, #count） */
export const TMS9995_FMT5 = new Set(["SRA", "SRL", "SLA", "SRC"]);

/** Format 6（汎用アドレス 1 つ） */
export const TMS9995_FMT6 = new Set([
	"BLWP",
	"B",
	"X",
	"CLR",
	"NEG",
	"INV",
	"INC",
	"INCT",
	"DEC",
	"DECT",
	"BL",
	"SWPB",
	"SETO",
	"ABS",
	"DIVS",
	"MPYS",
]);

/** Format 7（オペランド無し） */
export const TMS9995_FMT7 = new Set([
	"IDLE",
	"RSET",
	"RTWP",
	"CKON",
	"CKOF",
	"LREX",
]);

/** Format 8: Rn, #imm */
export const TMS9995_FMT8_REG_IMM = new Set(["LI", "AI", "ANDI", "ORI", "CI"]);

/** Format 8: #imm のみ */
export const TMS9995_FMT8_IMM = new Set(["LWPI", "LIMI"]);

/** Format 8: Rn のみ */
export const TMS9995_FMT8_REG = new Set(["STWP", "STST", "LST", "LWP"]);

/** Format 9: XOP src, #n / MPY|DIV src, Rn */
export const TMS9995_FMT9_XOP = "XOP";
export const TMS9995_FMT9_MULDIV = new Set(["MPY", "DIV"]);

const TMS9995_DIRECTIVES = [
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
	".END",
	"END",
] as const;

const TMS9995_REGISTERS = [
	"R0",
	"R1",
	"R2",
	"R3",
	"R4",
	"R5",
	"R6",
	"R7",
	"R8",
	"R9",
	"R10",
	"R11",
	"R12",
	"R13",
	"R14",
	"R15",
] as const;

/** TMS9995 アーキテクチャ定義（retrocpu_asm 全命令） */
export const tms9995Architecture: CpuArchitecture = {
	id: "tms9995",
	displayName: "TMS9995",
	extensions: [...SHARED_ASM_EXTENSIONS, "tms9995"],
	languageId: "tms9995asm",
	mnemonics: new Set(TMS9995_MNEMONICS),
	directives: new Set(TMS9995_DIRECTIVES),
	registers: new Set(TMS9995_REGISTERS),
	callMnemonics: new Set(["BL", "BLWP"]),
	labelRefMnemonics: new Set([
		"B",
		"BL",
		"BLWP",
		"JMP",
		"JLT",
		"JLE",
		"JEQ",
		"JHE",
		"JGT",
		"JNE",
		"JNC",
		"JOC",
		"JNO",
		"JL",
		"JH",
		"JOP",
	]),
	callingConvention: TMS9995_CALLING_CONVENTION,
};
