FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# postinstall runs fumadocs-mdx, which needs the source tree — skip scripts
# here and run the generation explicitly after the copy.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# NEXT_PUBLIC_* is inlined at build time. Empty = same-origin relative calls,
# which is exactly right behind the single-origin proxy.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npx fumadocs-mdx && npx next build

EXPOSE 3000

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
