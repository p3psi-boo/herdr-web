# cache.dockerfile — 仅供 docker:cache 内置任务构建依赖缓存镜像使用。
# 与 Dockerfile 构建阶段第 1-4 行保持完全一致（同 base、同 WORKDIR、同 COPY、同 RUN），
# 这样用 --cache-from 引用时依赖安装层可以直接命中缓存。
FROM oven/bun:1.3

WORKDIR /app

# docker:cache 构建时上下文中只存在 by 声明的文件，其余文件视为不存在
COPY package.json bun.lock bunfig.toml ./

RUN bun install --frozen-lockfile
