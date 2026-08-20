export const ASM_LANGUAGE_IDS = ["mn1613asm", "tms9995asm"] as const;

export type AsmLanguageId = (typeof ASM_LANGUAGE_IDS)[number];

export function isAsmLanguageId(languageId: string): boolean {
	return (ASM_LANGUAGE_IDS as readonly string[]).includes(languageId);
}

export const ASM_DOCUMENT_SELECTOR: readonly { language: AsmLanguageId }[] =
	ASM_LANGUAGE_IDS.map((language) => ({ language }));
