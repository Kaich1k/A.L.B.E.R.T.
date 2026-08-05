# Albert snapshots

`albert-pre-operations-expansion-2026-08-05.tar.gz` is the source/configuration snapshot taken before
the Operations, JARVIS interface, and final voice-reliability expansion.

- SHA-256: `13570b398bb95e35a6fc58780ba3ca00da39934efbfe684aa345dff0680b66b4`
- It intentionally preserves the earlier project separately from the installed app replacement.

To inspect or restore safely, extract it into a new empty directory rather than over the active tree:

```bash
restore_dir="$(mktemp -d /tmp/albert-restore.XXXXXX)"
tar -xzf albert-pre-operations-expansion-2026-08-05.tar.gz -C "$restore_dir"
```
