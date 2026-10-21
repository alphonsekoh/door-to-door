#!/usr/bin/env bash
# Scratch only: called by the E2E diag fixture when a test is still running
# well past what any test takes, to see what the WebKit processes are doing.
label="$1"
mkdir -p stall-diag
out="stall-diag/$(date +%s%N).txt"

threads() {
  for pid in $(pgrep -f 'WebProcess' || true); do
    echo "=== PID $pid: $(tr '\0' ' ' < /proc/$pid/cmdline | cut -c1-200)"
    for t in /proc/$pid/task/*; do
      tid=${t##*/}
      echo "$tid $(cat $t/comm 2>/dev/null) $(sed 's/.*) //' $t/stat 2>/dev/null | awk '{print "state=" $1, "utime=" $12, "stime=" $13}') wchan=$(sudo cat $t/wchan 2>/dev/null)"
    done
  done
}

{
  echo "##### $label"
  date -u
  uptime
  ps -eo pid,ppid,stat,pcpu,rss,etime,comm --sort=-pcpu | head -30
  threads
  sleep 3
  echo "##### 3s later"
  threads
  for pid in $(pgrep -f 'WebProcess' || true); do
    echo "##### GDB $pid"
    sudo timeout 120 gdb -p "$pid" -batch -nx -ex 'set pagination off' -ex 'thread apply all bt 50' 2>&1 \
      | grep -v '^\[New LWP' | head -2500
    echo "##### kernel stacks $pid"
    for t in /proc/$pid/task/*; do echo "-- ${t##*/} $(cat $t/comm)"; sudo cat $t/stack 2>/dev/null | head -12; done
  done
} > "$out" 2>&1
echo "$out"
