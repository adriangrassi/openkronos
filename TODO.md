# To do

## Full Backup

- [ ] Build restore for the raw backup files: KARMA GEs, KARMA Templates, Drum Track Patterns and Songs. Today they can only be saved. Restoring writes to the keyboard, so it needs an explicit action and a confirmation.
- [ ] Test loading a Full Backup `.PCG` on the real Kronos through Disk mode. Do a Disk mode Save All to a USB drive first, because loading replaces what is in memory.
- [ ] Decide how samples and multisamples get backed up. They cannot travel over USB, so they need Disk mode on the keyboard.
- [ ] Fix the HD-1 backup gap. KORG documents an HD-1 Program as 3,706 bytes over USB, but a `.PCG` slot holds 4,960, and 384 of the 1,152 factory HD-1 Programs have data in the extra space. Full Backup fills it with zeros. Find out whether those bytes change the sound by restoring one affected Program and comparing it, then find a way to capture them.
- [ ] Warn in the Send and Store confirmations to do a Disk mode Save All first. Remove the warning once restore exists and one load has worked on the real keyboard.

## From the feature build

- [ ] Combi builder from a MIDI file: not merged. Its test contradicts itself on the U-AA..U-GG bank numbers (branch f-combibuilder).
- [ ] Recorder: a saved take doesn't close notes still held at Stop.
- [ ] Playlist: "Now playing" stays stuck if the keyboard disconnects mid-song.
- [ ] Player: Mute and Solo in keyboard channel mode have no automated test.
- [ ] Player: seeking before the first Play skips the file's own setup messages; Loop to the far right stops instead of looping.
