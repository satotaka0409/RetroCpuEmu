; Handshake constants for TMS9995 monitor

HSHK_OK             .equ 0x0000
HSHK_NG             .equ 0x0001
HSHK_MODE_ERROR     .equ 0x0002

HSHK_CMD_MODE_SET       .equ 0x10
HSHK_CMD_GET_TIME       .equ 0x11
HSHK_CMD_TIMER_SET      .equ 0x12
HSHK_CMD_READ_MEMORY    .equ 0x13
HSHK_CMD_WRITE_MEMORY   .equ 0x14
HSHK_CMD_READ_IO        .equ 0x15
HSHK_CMD_WRITE_IO       .equ 0x16
HSHK_CMD_BREAK_HIST     .equ 0x17
HSHK_CMD_BREAK_RESUME   .equ 0x18
