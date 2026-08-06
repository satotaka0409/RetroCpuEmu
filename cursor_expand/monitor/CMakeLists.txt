# SDCC MN1613 ツールチェーン（sdasmn1613 / sdld）を構築する薄い CMake ラッパ。
# 実ビルドは SDCC ツリー内の既存 Makefile を呼び出す。
#
# Usage:
#   make -C cursor_expand/monitor sdcc-setup
# or:
#   cmake -S . -B build/cmake -DSDCC_SRC_DIR=$HOME/sdcc-mn1613/sdcc/build/sdcc
#   cmake --build build/cmake --target sdcc_mn1613_tools

cmake_minimum_required(VERSION 3.16)
project(monitor_mn1613_sdcc LANGUAGES NONE)

# 既定: 設定済みの sdcc-mn1613 ビルドツリー（configure 済みソース＋ bin/）
if(NOT DEFINED SDCC_SRC_DIR OR SDCC_SRC_DIR STREQUAL "")
  set(SDCC_SRC_DIR "$ENV{HOME}/sdcc-mn1613/sdcc/build/sdcc")
endif()
if(NOT DEFINED SDCC_BIN_DIR OR SDCC_BIN_DIR STREQUAL "")
  set(SDCC_BIN_DIR "${SDCC_SRC_DIR}/bin")
endif()

set(SDASMN1613_DIR "${SDCC_SRC_DIR}/sdas/asmn1613")
set(LINKSRC_DIR    "${SDCC_SRC_DIR}/sdas/linksrc")

set(SDASMN1613 "${SDCC_BIN_DIR}/sdasmn1613")
set(SDLD       "${SDCC_BIN_DIR}/sdld")

if(NOT EXISTS "${SDASMN1613_DIR}/Makefile")
  message(FATAL_ERROR
    "SDCC asmn1613 not found: ${SDASMN1613_DIR}/Makefile\n"
    "Set -DSDCC_SRC_DIR=... (expected .../sdcc/build/sdcc).")
endif()
if(NOT EXISTS "${LINKSRC_DIR}/Makefile")
  message(FATAL_ERROR
    "SDCC linksrc not found: ${LINKSRC_DIR}/Makefile\n"
    "Set -DSDCC_SRC_DIR=... (expected .../sdcc/build/sdcc).")
endif()

file(MAKE_DIRECTORY "${SDCC_BIN_DIR}")

# asmn1613 → $(SDCC_SRC_DIR)/bin/sdasmn1613
add_custom_command(
  OUTPUT "${SDASMN1613}"
  COMMAND ${CMAKE_COMMAND} -E echo "Building sdasmn1613 in ${SDASMN1613_DIR}"
  COMMAND ${CMAKE_MAKE_PROGRAM} -C "${SDASMN1613_DIR}"
  COMMENT "Build sdasmn1613 -> ${SDASMN1613}"
  VERBATIM
)

# linksrc → $(SDCC_SRC_DIR)/bin/sdld （Makefile の ASLINK）
add_custom_command(
  OUTPUT "${SDLD}"
  COMMAND ${CMAKE_COMMAND} -E echo "Building sdld in ${LINKSRC_DIR}"
  COMMAND ${CMAKE_MAKE_PROGRAM} -C "${LINKSRC_DIR}" sdcc-ld8051
  COMMENT "Build sdld -> ${SDLD}"
  VERBATIM
)

add_custom_target(sdcc_mn1613_tools ALL
  DEPENDS "${SDASMN1613}" "${SDLD}"
)

message(STATUS "SDCC_SRC_DIR = ${SDCC_SRC_DIR}")
message(STATUS "SDCC_BIN_DIR = ${SDCC_BIN_DIR}")
message(STATUS "Expect: ${SDASMN1613}")
message(STATUS "Expect: ${SDLD}")
