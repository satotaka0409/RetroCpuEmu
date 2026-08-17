# SDCC ツールチェーン（sdld）を構築する薄い CMake ラッパ。
# 実ビルドは SDCC ツリー内の既存 Makefile を呼び出す。
#
# Usage:
#   make -C retrocpu_boot_monitor sdcc-setup
# or:
#   cmake -S . -B build/cmake -DSDCC_SRC_DIR=$HOME/sdcc-mn1613/sdcc/build/sdcc
#   cmake --build build/cmake --target sdcc_mn1613_tools

cmake_minimum_required(VERSION 3.16)
project(monitor_mn1613_sdcc LANGUAGES NONE)

# 既定: 設定済みの sdcc-mn1613 ビルドツリー（configure 済みソース＋ bin/）
if(NOT DEFINED SDCC_SRC_DIR OR SDCC_SRC_DIR STREQUAL "")
  set(SDCC_SRC_DIR "$ENV{HOME}/sdcc-mn1613/sdcc/build/sdcc")
  if(NOT EXISTS "${SDCC_SRC_DIR}/sdas/linksrc/Makefile"
     AND EXISTS "$ENV{HOME}/sdcc-mn1613/sdcc/sdcc/sdas/linksrc/Makefile")
    set(SDCC_SRC_DIR "$ENV{HOME}/sdcc-mn1613/sdcc/sdcc")
  endif()
endif()
if(NOT DEFINED SDCC_BIN_DIR OR SDCC_BIN_DIR STREQUAL "")
  set(SDCC_BIN_DIR "${SDCC_SRC_DIR}/bin")
endif()

set(LINKSRC_DIR    "${SDCC_SRC_DIR}/sdas/linksrc")

set(SDLD       "${SDCC_BIN_DIR}/sdld")

if(NOT EXISTS "${LINKSRC_DIR}/Makefile")
  message(FATAL_ERROR
    "SDCC linksrc not found: ${LINKSRC_DIR}/Makefile\n"
    "Set -DSDCC_SRC_DIR=... (expected .../sdcc/build/sdcc).")
endif()

file(MAKE_DIRECTORY "${SDCC_BIN_DIR}")

# linksrc → $(SDCC_SRC_DIR)/bin/sdld （Makefile の ASLINK）
add_custom_command(
  OUTPUT "${SDLD}"
  COMMAND ${CMAKE_COMMAND} -E echo "Building sdld in ${LINKSRC_DIR}"
  COMMAND ${CMAKE_MAKE_PROGRAM} -C "${LINKSRC_DIR}" sdcc-ld8051
  COMMENT "Build sdld -> ${SDLD}"
  VERBATIM
)

add_custom_target(sdcc_mn1613_tools ALL
  DEPENDS "${SDLD}"
)

message(STATUS "SDCC_SRC_DIR = ${SDCC_SRC_DIR}")
message(STATUS "SDCC_BIN_DIR = ${SDCC_BIN_DIR}")
message(STATUS "Expect: ${SDLD}")
