# herdr-web — multi-stage Docker build.
#
# Stage 1: lockfile-pinned `bun install` + compile the whole fullstack app
#          (server + React UI + Tailwind v4 CSS) into ONE self-contained
#          binary with the Bun runtime embedded.
# Stage 2: minimal glibc runtime. The binary is self-contained; the only
#          runtime PATH deps are `ssh` (for SSH devices) and `herdr`
#          (for local devices — drop in a copy if you have it).
#
# Run (OrbStack / Docker Desktop on macOS):
#   docker build -t herdr-web .
#   docker run -d --name herdr-web \
#     -p 127.0.0.1:7317:7317 \
#     -e HERDR_WEB_HOST=0.0.0.0 \
#     -e HERDR_WEB_PASSWORD=... \
#     -e HERDR_WEB_TOKEN=... \
#     -v ~/.ssh:/root/.ssh:ro \
#     -v /run/host-services/ssh-auth.sock:/ssh-agent \
#     -e SSH_AUTH_SOCK=/ssh-agent \
#     -v ~/.config/herdr-web:/root/.config/herdr-web \
#     herdr-web
#
# SSH agent: do NOT bind-mount $SSH_AUTH_SOCK from macOS (virtiofs inode,
# Connection refused). OrbStack/Docker Desktop inject a real AF_UNIX at
# /run/host-services/ssh-auth.sock that talks to the host agent (rbw,
# 1Password, ssh-agent). herdr-web uses BatchMode, so this is required.
# ~/.ssh is only config + known_hosts. This is client-side agent use, not
# ForwardAgent.
#
# Local herdr.sock cannot be bind-mounted from macOS for the same reason.
# Use SSH devices from the container, or run herdr-web on the host for Local.

# ---------------- build stage ----------------
FROM oven/bun:1.3 AS build
WORKDIR /app

# Layer deps first for cache reuse.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Source + bundle.
COPY . .
RUN bun build ./src/server/index.ts \
      --target bun \
      --compile \
      --plugins=bun-plugin-tailwind \
      --minify \
      --outfile herdr-web

# ---------------- runtime stage ----------------
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/herdr-web /usr/local/bin/herdr-web

ENV NODE_ENV=production
EXPOSE 7317
CMD ["herdr-web"]