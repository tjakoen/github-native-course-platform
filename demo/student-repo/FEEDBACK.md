# Feedback - m2a1

Really solid submission. The way you split the list, the row, and the empty-state
into separate components made the whole thing easy to follow, and I liked that you
handled the loading and empty cases instead of only the happy path. That is the
habit that separates a demo from something you would actually ship.

One thing to look into next: a couple of your buttons use only an icon, with no
text. Have a read about how screen readers announce controls that have no visible
label, and what an "accessible name" is. See if you can work out how to give those
icon buttons a name without changing how they look. It is a small change that makes
a real difference for people using assistive tech.

Keep going the way you are. The structure and the attention to edge cases are
exactly right for this stage.
