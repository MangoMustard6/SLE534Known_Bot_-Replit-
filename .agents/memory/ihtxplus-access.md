---
name: IHTXPlus access
description: The access scope chosen for the bot's raw FFmpeg option command.
---

Anyone who can use the Discord bot may invoke IHTXPlus with raw FFmpeg options, including network URLs.

**Why:** the project owner chose broad access and then explicitly chose to keep network access after being told FFmpeg options can access files and network resources available to the bot.

**How to apply:** Keep IHTXPlus available wherever the bot is available and do not block FFmpeg network protocols. Pass its options directly as process arguments; never execute them through a shell.
