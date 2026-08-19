# RFC-300: The AI review loop

A plain-markdown fixture for the M4 journeys (#137): the agent hop over MCP, the
thread-panel triage pair, and AI-proposed comment splits. Deliberately dull —
one heading level, ordinary prose, no diagrams and no images — so a failure
points at the AI surface under test rather than at the document.

## Anchors

Every sentence a journey anchors to lives on ONE source line, unwrapped. The
rendered prose keeps the source's line breaks inside a paragraph, and the
selection helper matches inside a single text node, so a sentence split across
two source lines could not be selected as written.

Two things matter here: the anchor must survive a re-import, and the digest is only ever a draft the author confirms.

## Agents

An agent reviewer reads this document over MCP and answers in the same rail as a person.

## Drafts

A stance is the author's decision, and the model writes the reply they already chose.

## Coverage

A digest counts every thread on this document and says so in one honest sentence.
