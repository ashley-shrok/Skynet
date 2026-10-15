# Fix: one-line sensor findings shown as a file pointer

**Opened:** 2026-10-15 (reported by Jarvis after migrating his sensors)

- **Observed:** a one-line finding ending in a newline (as `echo` writes it) is treated as multi-line, so the 📡 line points at the delivered fire file instead of showing it inline.
- **Correct after fix:** a single trailing newline is ignored when deciding inline vs pointer; the inline text has no trailing newline. Real multi-line findings are still pointed at.
- **Suspected file:** the wake-up scheduler's sensor wake line (`substrate/scripts/wakeup-scheduler.py`, the emit-sensor-wake step).

## Change

The sensor wake line drops one trailing newline (and a carriage return before it) from the findings before deciding inline vs pointer, and shows the trimmed text inline. Test SA-G15's first fire now ends in a newline and must still be inline.

done: scheduler suite 18/18 pass; a `two candidates\n` fire is delivered inline as "— findings: two candidates", multi-line findings still pointed at.
