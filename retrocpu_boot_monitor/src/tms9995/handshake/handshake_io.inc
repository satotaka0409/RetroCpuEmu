; Handshake constants for TMS9995 monitor
	.include "../interrupt_io.inc"

HSHK_OK             .equ 0x0000
HSHK_NG             .equ 0x0001
HSHK_MODE_ERROR     .equ 0x0002

HSHK_CMD_MODE_SET       .equ 0x10
HSHK_CMD_GET_TIME       .equ 0x11
HSHK_CMD_TIMER_SET      .equ 0x12
HSHK_CMD_UNDEF_LED      .equ 0x13
HSHK_CMD_HEX_KEY        .equ 0x14
HSHK_CMD_PC_KEY         .equ 0x15
HSHK_CMD_LED_DISPLAY    .equ 0x16
HSHK_CMD_LCD_CTRL       .equ 0x17
HSHK_CMD_LCD_TEXT       .equ 0x18
HSHK_CMD_BEEP           .equ 0x19
HSHK_CMD_BREAK_NOTIFY   .equ 0x1A
HSHK_CMD_STEP_NOTIFY    .equ 0x1B
HSHK_CMD_RTC_GET_RAW    .equ 0x1C
HSHK_CMD_TEMP_GET_RAW   .equ 0x1D
HSHK_CMD_LIGHT_GET_RAW  .equ 0x1E
HSHK_CMD_DISTANCE_GET_RAW .equ 0x1F

HSHK_HEX_KEY_COLS       .equ 8

HSHK_CMD_READ_MEMORY    .equ 0x13
HSHK_CMD_WRITE_MEMORY   .equ 0x14
HSHK_CMD_READ_IO        .equ 0x15
HSHK_CMD_WRITE_IO       .equ 0x16
HSHK_CMD_BREAK_HIST     .equ 0x17
HSHK_CMD_BREAK_RESUME   .equ 0x18
