# Images and links

A paragraph with an ![architecture diagram](https://example.test/arch.png) inline
image, some `inline code`, and a [link to the spec](https://kedge.review/spec)
whose visible text is anchor text but whose URL is not.

![standalone image](https://example.test/standalone.png)

Text after the standalone image stays anchorable, and its offsets are stable
because the image collapses to a fixed-width placeholder token.
