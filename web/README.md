# web

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `app/(app)`               | The authenticated shell (`/`), guarded server-side via the BFF.   |
| `app/(auth)`              | Public sign-in / sign-up pages (`/signin`, `/signup`).            |
| `app/docs`                | The documentation layout and pages (public).                      |
| `app/api/bff/me/route.ts` | BFF read handler — forwards cookies to the API's `/api/v1/me`.     |
| `app/api/search/route.ts` | The Route Handler for search.                                     |

Auth (SPEC §4): client components call the API directly for mutations
(`lib/auth-client.ts`); server components read session state through the BFF
(`lib/session.ts` / `app/api/bff/me`). API base URLs are env-driven — see
`.env.example`.

### Fumadocs MDX

A `source.config.ts` config file has been included, you can customise different options like frontmatter schema.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
