	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_handshake_interrupt_handler
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global g_hshk_send_byte
	.global g_hshk_read_memory
	.global g_hshk_write_memory
	.global g_hshk_read_io
	.global g_hshk_write_io
	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr
	.global g_hshk_break_hist_get
	.global g_hshk_break_resume

	.area	_CODE		(REL,CON)
g_handshake_interrupt_handler:
	BL	g_hshk_accept_request
	BL	g_hshk_recv_byte
	MOV	R1, R0
	CI	R0, #HSHK_CMD_READ_MEMORY
	JEQ	l_cmd_rm
	CI	R0, #HSHK_CMD_WRITE_MEMORY
	JEQ	l_cmd_wm
	CI	R0, #HSHK_CMD_READ_IO
	JEQ	l_cmd_ri
	CI	R0, #HSHK_CMD_WRITE_IO
	JEQ	l_cmd_wi
	CI	R0, #HSHK_CMD_MODE_SET
	JEQ	l_cmd_mode
	CI	R0, #HSHK_CMD_BREAK_HIST
	JEQ	l_cmd_hist
	CI	R0, #HSHK_CMD_BREAK_RESUME
	JEQ	l_cmd_resume
	JMP	l_done
l_cmd_rm:
	BL	g_hshk_read_memory
	JMP	l_done
l_cmd_wm:
	BL	g_hshk_write_memory
	JMP	l_done
l_cmd_ri:
	BL	g_hshk_read_io
	JMP	l_done
l_cmd_wi:
	BL	g_hshk_write_io
	JMP	l_done
l_cmd_mode:
	BL	g_hshk_addr_break_set
	JMP	l_done
l_cmd_hist:
	BL	g_hshk_break_hist_get
	JMP	l_done
l_cmd_resume:
	BL	g_hshk_break_resume
l_done:
	BL	g_hshk_finalize_recv
	B	(R11)
