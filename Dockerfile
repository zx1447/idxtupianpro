FROM node:20-slim

# 安装 unzip 和 python3 (作为解压备用方案)，并创建非 root 用户
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    ca-certificates \
    curl \
    python3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# 复制源码
COPY index.js .

# 创建所需目录并将目录权限赋予非 root 用户
RUN mkdir -p /app/logs /app/agent_dir \
    && chown -R appuser:appuser /app

# 切换为非 root 用户运行（很多 PaaS 平台强制要求）
USER appuser

# 暴露端口
ENV PORT=4567
EXPOSE 4567

# 启动
CMD ["node", "index.js"]
