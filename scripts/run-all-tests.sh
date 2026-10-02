#!/bin/bash
# Run every tests/*.test.js and tests/integration/*.test.js, summarising pass/fail.
set +e
pass=0
fail=0
fail_names=()
for f in tests/*.test.js tests/integration/*.test.js; do
  out=$(node "$f" 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    fail_names+=("$f")
  fi
done
echo "PASSED: $pass"
echo "FAILED: $fail"
if [ ${#fail_names[@]} -gt 0 ]; then
  echo "Failing tests:"
  for n in "${fail_names[@]}"; do echo "  - $n"; done
fi
[ $fail -eq 0 ] && exit 0 || exit 1
