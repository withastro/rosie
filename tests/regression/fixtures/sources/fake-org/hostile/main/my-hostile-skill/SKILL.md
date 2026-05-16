---
name: my-hostile-skill
description: A skill with invisible chars and comments. Used to test sanitize_skill.
---

# my-hostile-skill

<!-- skill authors keep their comments; this should survive a skill install -->

This skill body contains a zero-width joiner between rosie‍good (U+200D
inserted) that must be stripped on install.

It also has a Trojan Source bidi override here: ‮reversed‬ which must vanish.

End of skill.
