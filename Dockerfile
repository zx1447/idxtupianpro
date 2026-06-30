FROM node:22-alpine

# 安装系统依赖 + 预下载 nezha-agent 到系统目录，自动适配架构
RUN apk update && apk add --no-cache unzip python3 bash procps wget \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64)  ARCH="amd64" ;; \
        aarch64) ARCH="arm64" ;; \
        armv7l)  ARCH="armv7" ;; \
        *)       ARCH="amd64" ;; \
    esac \
    && wget -q -O /tmp/agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" \
    && unzip -q /tmp/agent.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/nezha-agent \
    && rm -f /tmp/agent.zip

WORKDIR /app

COPY index.js /app/index.js

EXPOSE 4567

CMD ["node", "index.js"]
