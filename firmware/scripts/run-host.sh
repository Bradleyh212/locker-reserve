#!/bin/sh
set -eu

firmware_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$firmware_dir/build"
compiler=${CXX:-c++}

"$compiler" -std=c++17 -Wall -Wextra -Werror -pedantic   -I"$firmware_dir/include" -I"$firmware_dir/sim"   "$firmware_dir/src/locker.cpp" "$firmware_dir/test/locker_test.cpp"   -o "$firmware_dir/build/locker-tests"
"$firmware_dir/build/locker-tests"

"$compiler" -std=c++17 -Wall -Wextra -Werror -pedantic   -I"$firmware_dir/include"   "$firmware_dir/test/ota_policy_test.cpp"   -o "$firmware_dir/build/ota-policy-tests"
"$firmware_dir/build/ota-policy-tests"

"$compiler" -std=c++17 -Wall -Wextra -Werror -pedantic   -I"$firmware_dir/include" -I"$firmware_dir/sim"   "$firmware_dir/src/locker.cpp" "$firmware_dir/sim/main.cpp"   -o "$firmware_dir/build/locker-sim"
"$firmware_dir/build/locker-sim"
