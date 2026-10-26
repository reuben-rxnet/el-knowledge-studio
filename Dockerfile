# EL Knowledge Studio — production image (Next.js standalone server).
#   docker build -t el-knowledge-studio .
#   docker run -p 3000:3000 --env-file .env.production el-knowledge-studio
# LibreOffice (headless) turns PPTX/DOCX into page images for document videos.
# FFmpeg comes from the Debian package here; check its licence with Legal (see docs/third-party.md)
# or point FFMPEG_PATH at an approved LGPL build.

FROM node:22-bookworm-slim AS deps
# Prisma picks its query engine from the OpenSSL it finds; without it, it builds the wrong one (1.1 vs 3.0).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Native packages (Prisma engines, ONNX Runtime, sharp) need their install scripts.
RUN npm ci --no-audit --no-fund --ignore-scripts=false

# The Prisma CLI applies the schema on start. It is installed on its own (with its engines and all
# dependencies) because the standalone server bundle only carries the runtime client.
FROM node:22-bookworm-slim AS prisma-cli
WORKDIR /cli
RUN npm init -y >/dev/null && npm install --no-audit --no-fund prisma@6.19.3

FROM deps AS build
WORKDIR /app
ARG PRISMA_PROVIDER=postgresql
COPY . .
# The image targets PostgreSQL: switch the schema's provider before generating the client.
RUN node scripts/prisma-provider.mjs ${PRISMA_PROVIDER} && npx prisma generate && NEXT_OUTPUT=standalone npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 MODELS_DIR=/app/models FFMPEG_PATH=/usr/bin/ffmpeg STORAGE_DIR=/app/storage
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-liberation ca-certificates openssl libreoffice-impress libreoffice-writer && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app && useradd --system --gid app --home /app app && mkdir -p /app/models /app/storage && chown -R app:app /app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=prisma-cli --chown=app:app /cli/node_modules /app/prisma-cli/node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply the schema on start (pilot). Production: run migrations as a separate release step.
CMD ["sh", "-c", "node prisma-cli/node_modules/prisma/build/index.js db push --skip-generate --schema prisma/schema.prisma && node server.js"]
