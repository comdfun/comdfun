# Company.md website (apps/web, Next.js `output: "standalone"`) for Railway (https://comd.fun).
#
#   docker build -f infra/docker/web.Dockerfile -t comd-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.comd.fun --build-arg NEXT_PUBLIC_CHAIN_ID=4663 .
#   docker run -p 3000:3000 comd-web
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time. On Railway every service variable whose
# name matches an ARG below is passed as a build arg automatically, so: set them on the web service, then redeploy
# (a restart is not enough after changing one).

ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------------------------------------------ manifests only
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /manifests \
 && cp --parents package.json package-lock.json packages/*/package.json apps/*/package.json /manifests/

# ------------------------------------------------------------------------------------------------ build
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=manifests /manifests/ ./
RUN npm ci
COPY . .

# Workspace packages the site imports. apps/web/next.config.mjs aliases @company/art and @company/abi to their
# built entry, else their src/, else its own fallbacks, so a missing or failing art build degrades instead of
# breaking the site build.
RUN npm run build -w @company/art --if-present \
 || echo "[web.Dockerfile] warning: @company/art build failed; the site will use its source/fallback icons"
RUN npm run build -w @company/abi --if-present

ARG NEXT_PUBLIC_API_URL=https://api.comd.fun
ARG NEXT_PUBLIC_SITE_URL=https://comd.fun
ARG NEXT_PUBLIC_MOCK=0
ARG NEXT_PUBLIC_CHAIN_ID=4663
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_EXPLORER_URL=https://robinhoodchain.blockscout.com
ARG NEXT_PUBLIC_WC_PROJECT_ID
ARG NEXT_PUBLIC_ALLOWLIST_URL
ARG NEXT_PUBLIC_SITES_DOMAIN=sites.comd.fun
ARG NEXT_PUBLIC_MARKETPLACE_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL=team@comd.fun
ARG NEXT_PUBLIC_X_URL=https://x.com/comdfun
ARG NEXT_PUBLIC_COUNSEL_NFT
ARG NEXT_PUBLIC_COMD_TOKEN
ARG NEXT_PUBLIC_SWAPPER
ARG NEXT_PUBLIC_PONS_URL
ARG NEXT_PUBLIC_UNISWAP_URL
ARG NEXT_PUBLIC_FLYWHEEL
ARG NEXT_PUBLIC_PERMIT2
ARG NEXT_PUBLIC_INCORPORATIONS
ARG NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK=0
ARG NEXT_PUBLIC_IDENTITY_REGISTRY
ARG NEXT_PUBLIC_REVENUE_ROUTER
ARG NEXT_PUBLIC_REWARD_DISTRIBUTOR
ARG NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_MOCK=$NEXT_PUBLIC_MOCK \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL \
    NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID \
    NEXT_PUBLIC_ALLOWLIST_URL=$NEXT_PUBLIC_ALLOWLIST_URL \
    NEXT_PUBLIC_SITES_DOMAIN=$NEXT_PUBLIC_SITES_DOMAIN \
    NEXT_PUBLIC_MARKETPLACE_URL=$NEXT_PUBLIC_MARKETPLACE_URL \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_X_URL=$NEXT_PUBLIC_X_URL \
    NEXT_PUBLIC_COUNSEL_NFT=$NEXT_PUBLIC_COUNSEL_NFT \
    NEXT_PUBLIC_COMD_TOKEN=$NEXT_PUBLIC_COMD_TOKEN \
    NEXT_PUBLIC_SWAPPER=$NEXT_PUBLIC_SWAPPER \
    NEXT_PUBLIC_PONS_URL=$NEXT_PUBLIC_PONS_URL \
    NEXT_PUBLIC_UNISWAP_URL=$NEXT_PUBLIC_UNISWAP_URL \
    NEXT_PUBLIC_FLYWHEEL=$NEXT_PUBLIC_FLYWHEEL \
    NEXT_PUBLIC_PERMIT2=$NEXT_PUBLIC_PERMIT2 \
    NEXT_PUBLIC_INCORPORATIONS=$NEXT_PUBLIC_INCORPORATIONS \
    NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK=$NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK \
    NEXT_PUBLIC_IDENTITY_REGISTRY=$NEXT_PUBLIC_IDENTITY_REGISTRY \
    NEXT_PUBLIC_REVENUE_ROUTER=$NEXT_PUBLIC_REVENUE_ROUTER \
    NEXT_PUBLIC_REWARD_DISTRIBUTOR=$NEXT_PUBLIC_REWARD_DISTRIBUTOR \
    NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR=$NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR

RUN npm run build -w @company/web \
 && test -f apps/web/.next/standalone/apps/web/server.js

# ------------------------------------------------------------------------------------------------ runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# standalone output is rooted at the monorepo (outputFileTracingRoot), so server.js lives in apps/web/
COPY --from=build --chown=node:node /app/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# Railway injects PORT; Next's standalone server reads PORT and HOSTNAME.
CMD ["node", "apps/web/server.js"]
