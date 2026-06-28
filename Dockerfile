FROM node:20-slim

# 安装必要工具，并在构建阶段提前下载 nezha-agent
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 提前下载并解压 nezha-agent 到 /usr/local/bin，确保拥有执行权限
RUN arch=$(uname -m) && \
    if [ "$arch" = "x86_64" ]; then arch="amd64"; fi && \
    if [ "$arch" = "aarch64" ]; then arch="arm64"; fi && \
    curl -L -o /tmp/agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${arch}.zip" && \
    unzip -o /tmp/agent.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/nezha-agent && \
    rm -f /tmp/agent.zip

# 复制源码
COPY index.js .

# 创建非 root 用户（如果平台强制要求）
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

ENV PORT=4567
EXPOSE 4567

CMD ["node", "index.js"]
