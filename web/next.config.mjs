import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Share links are "private links" (SPEC 10.2): keep the whole /shared
        // subtree — the read surface and the friendly gone page alike — out of
        // search indexes. The <meta name="robots"> tag is set by the /shared
        // layout; this is the matching HTTP header, seen even without executing
        // the page.
        source: '/shared/:token*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default withMDX(config);
