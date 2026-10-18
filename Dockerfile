# IPower Investments demo app. The Playwright base image already ships Chromium (used for receipt and
# quotation PDFs); its version must match the "playwright" package in package.json.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate

# Dependencies first so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile && pnpm exec prisma generate

# Build. next/font downloads the Geist font here, once; the running demo needs no internet.
COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
