FROM node:20-slim

# 安装 unzip 和基础证书
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制源码
COPY index.js .

# 创建日志目录
RUN mkdir -p /app/logs /tmp/agent_dir

# 暴露端口（很多 PaaS 默认要求 7860 或 8080，你可以根据平台要求修改此处的 4567）
ENV PORT=4567
EXPOSE 4567

# 启动命令
CMD ["node", "index.js"]
