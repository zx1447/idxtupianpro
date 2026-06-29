FROM node:20-slim

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/*

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --omit=dev

# 下载 nezha-agent（修复版）
RUN arch=$(uname -m) && \
    case "$arch" in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        armv7l) ARCH=arm ;; \
        *) ARCH=amd64 ;; \
    esac && \
    echo "Build arch: $ARCH" && \
    curl -fsSL --connect-timeout 15 -o /tmp/agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" && \
    unzip -o /tmp/agent.zip -d /tmp/agent/ && \
    mv /tmp/agent/nezha-agent /usr/local/bin/ && \
    chmod 755 /usr/local/bin/nezha-agent && \
    test -f /usr/local/bin/nezha-agent || exit 1 && \
    rm -rf /tmp/agent /tmp/agent.zip

# 复制业务代码
COPY index.js .

# 创建普通用户
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && chown -R appuser:appuser /app \
    && chmod 777 /tmp

ENV PORT=8080
EXPOSE 8080

USER appuser

CMD ["node", "index.js"]
