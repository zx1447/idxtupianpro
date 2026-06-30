FROM node:22-alpine

# 开启错误即终止，避免下载失败还继续构建
RUN set -e \
    && apk update && apk add --no-cache unzip python3 bash procps wget \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64)  ARCH="amd64" ;; \
        aarch64) ARCH="arm64" ;; \
        armv7l)  ARCH="armv7" ;; \
        *)       echo "不支持的架构: $ARCH" && exit 1 ;; \
    esac \
    # 国内优先用 Gitee 镜像，访问更稳定；海外平台可换回 GitHub
    && wget -q -O /tmp/agent.zip "https://gitee.com/naibahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" \
    && unzip -q /tmp/agent.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/nezha-agent \
    && rm -f /tmp/agent.zip \
    # 验证文件是否真实存在
    && test -f /usr/local/bin/nezha-agent

WORKDIR /app

COPY index.js /app/index.js

EXPOSE 8080

CMD ["node", "index.js"]
