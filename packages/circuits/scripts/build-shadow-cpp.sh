#!/bin/bash
# Build script for shadow circuit with C++ witness generator on ARM64 macOS
# This script handles the compilation and patching needed for Apple Silicon

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(dirname "$SCRIPT_DIR")"
CORES="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
HEARTBEAT_INTERVAL="${CIRCOM_HEARTBEAT_INTERVAL:-30}"
CIRCOM_WITH_SYM="${CIRCOM_WITH_SYM:-0}"

cd "$CIRCUITS_DIR"

echo "==> Compiling shadow circuit with circom (C++ mode, no assembly)..."
rm -rf build/shadow
mkdir -p build/shadow

start_time=$(date +%s)
heartbeat() {
  while true; do
    sleep "$HEARTBEAT_INTERVAL"
    now=$(date +%s)
    elapsed=$((now - start_time))
    echo "==> still compiling... ${elapsed}s elapsed"
  done
}

if [ "${CIRCOM_HEARTBEAT:-1}" = "1" ]; then
  heartbeat &
  HB_PID=$!
  trap 'kill "$HB_PID" 2>/dev/null' EXIT
fi

CIRCOM_FLAGS=(
  circuits/main/shadow.circom
  --r1cs --c --no_asm
  -o build/shadow
  -l node_modules
)

if [ "$CIRCOM_WITH_SYM" = "1" ]; then
  CIRCOM_FLAGS+=(--sym)
fi

if [ "${CIRCOM_VERBOSE:-1}" = "1" ]; then
  CIRCOM_FLAGS+=(--verbose --inspect)
fi

if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -oL -eL circom "${CIRCOM_FLAGS[@]}"
else
  circom "${CIRCOM_FLAGS[@]}"
fi

if [ -n "${HB_PID:-}" ]; then
  kill "$HB_PID" 2>/dev/null || true
  trap - EXIT
fi

echo "==> Patching fr.cpp for ARM64 macOS compatibility..."
cd build/shadow/shadow_cpp

python3 << 'PYEOF'
import re

with open('fr.cpp', 'r') as f:
    content = f.read()

# Add compatibility layer at the top
header = '''#include "fr.hpp"
#include <cstdint>
#include <cstring>

// ARM64 macOS compatibility layer
// uint64_t is unsigned long long on ARM64 macOS, but GMP uses unsigned long
#if defined(__APPLE__) && defined(__aarch64__)
namespace fr_compat {
    inline mp_ptr ptr(uint64_t* x) { return reinterpret_cast<mp_ptr>(x); }
    inline mp_srcptr srcptr(const uint64_t* x) { return reinterpret_cast<mp_srcptr>(x); }
    inline mp_srcptr srcptr(uint64_t* x) { return reinterpret_cast<mp_srcptr>(x); }
}
using fr_compat::ptr;
using fr_compat::srcptr;
#else
inline mp_ptr ptr(uint64_t* x) { return x; }
inline mp_srcptr srcptr(const uint64_t* x) { return x; }
inline mp_srcptr srcptr(uint64_t* x) { return x; }
#endif

'''

content = re.sub(
    r'#include "fr\.hpp"\s*\n#include <cstdint>\s*\n#include <cstring>\s*\n',
    header,
    content
)

# Patch all mpn_* functions
for func in ['mpn_add_n', 'mpn_sub_n', 'mpn_and_n', 'mpn_ior_n', 'mpn_xor_n', 'mpn_mul_n']:
    pattern = rf'{func}\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)'
    replacement = rf'{func}(ptr(\1), srcptr(\2), srcptr(\3), \4)'
    content = re.sub(pattern, replacement, content)

for func in ['mpn_copyi', 'mpn_com', 'mpn_sqr']:
    pattern = rf'{func}\(([^,]+),\s*([^,]+),\s*([^)]+)\)'
    replacement = rf'{func}(ptr(\1), srcptr(\2), \3)'
    content = re.sub(pattern, replacement, content)

for func in ['mpn_lshift', 'mpn_rshift']:
    pattern = rf'{func}\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)'
    replacement = rf'{func}(ptr(\1), srcptr(\2), \3, \4)'
    content = re.sub(pattern, replacement, content)

for func in ['mpn_add_1', 'mpn_sub_1', 'mpn_mul_1', 'mpn_addmul_1']:
    pattern = rf'{func}\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)'
    replacement = rf'{func}(ptr(\1), srcptr(\2), \3, \4)'
    content = re.sub(pattern, replacement, content)

pattern = r'mpn_add\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)'
replacement = r'mpn_add(ptr(\1), srcptr(\2), \3, srcptr(\4), \5)'
content = re.sub(pattern, replacement, content)

pattern = r'mpn_cmp\(([^,]+),\s*([^,]+),\s*([^)]+)\)'
replacement = r'mpn_cmp(srcptr(\1), srcptr(\2), \3)'
content = re.sub(pattern, replacement, content)

pattern = r'mpn_zero_p\(([^,]+),\s*([^)]+)\)'
replacement = r'mpn_zero_p(srcptr(\1), \2)'
content = re.sub(pattern, replacement, content)

pattern = r'mpn_zero\(([^,]+),\s*([^)]+)\)'
replacement = r'mpn_zero(ptr(\1), \2)'
content = re.sub(pattern, replacement, content)

content = re.sub(r'srcptr\((\w+)\+(\d+)\)', r'srcptr(\1)+\2', content)
content = re.sub(r'ptr\((\w+)\+(\d+)\)', r'ptr(\1)+\2', content)

with open('fr.cpp', 'w') as f:
    f.write(content)

print("Patched fr.cpp successfully")
PYEOF

echo "==> Updating Makefile with Homebrew paths..."
cat > Makefile << 'MAKEFILE'
CC=g++
# Homebrew paths for macOS
HOMEBREW_PREFIX=$(shell brew --prefix 2>/dev/null || echo /opt/homebrew)
CFLAGS=-std=c++11 -O3 -I. -I$(HOMEBREW_PREFIX)/include
LDFLAGS=-L$(HOMEBREW_PREFIX)/lib
DEPS_HPP = circom.hpp calcwit.hpp fr.hpp
DEPS_O = main.o calcwit.o fr.o

all: shadow

%.o: %.cpp $(DEPS_HPP)
	$(CC) -Wno-address-of-packed-member -c $< $(CFLAGS)

shadow: $(DEPS_O) shadow.o
	$(CC) -o shadow *.o $(LDFLAGS) -lgmp

clean:
	rm -f *.o shadow
MAKEFILE

echo "==> Building C++ witness generator..."
MAKEFLAGS="-j${CORES}" make

echo ""
echo "==> Build complete!"
echo "    R1CS: build/shadow/shadow.r1cs"
echo "    Witness generator: build/shadow/shadow_cpp/shadow"
