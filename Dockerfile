# ========== 阶段1：下载 nezha-agent（独立构建阶段，不残留多余工具） ==========
FROM alpine:latest AS agent-downloader

RUN apk add --no-cache wget unzip \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
        x86_64)  ARCH="amd64" ;; \
        aarch64) ARCH="arm64" ;; \
        armv7l)  ARCH="armv7" ;; \
        *)       ARCH="amd64" ;; \
    esac \
    && wget -q -O /tmp/agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" \
    && unzip -q /tmp/agent.zip -d /agent \
    && chmod +x /agent/nezha-agent

# ========== 阶段2：最终运行镜像 ==========
FROM node:22-alpine

WORKDIR /app

# 安装运行时最小依赖，无多余缓存
RUN apk add --no-cache bash procps tzdata ca-certificates \
    # 设置上海时区，避免日志时间异常
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 从构建阶段复制 nezha-agent 二进制文件
COPY --from=agent-downloader /agent/nezha-agent /usr/local/bin/nezha-agent

# ---------- Node 项目依赖安装 ----------
# 如果你的项目有 package.json 和第三方依赖，请取消下面两行注释
# COPY package.json ./
# RUN npm install --omit=dev --no-audit --no-fund

# 复制主程序文件
COPY index.js ./

# 环境变量默认配置
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    SERVER_PORT=4567 \
    # 哪吒面板连接参数，部署时在平台环境变量里填写即可
    NEZHA_SERVER="" \
    NEZHA_KEY=""

# 暴露服务端口
EXPOSE 4567

# 健康检查（适配 SnapDeploy 自动监控与重启规则）
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:4567/ || exit 1

# 启动脚本：同时运行哪吒 agent 与 Node 主程序
RUN echo '#!/bin/bash\n\
if [ -n "$NEZHA_SERVER" ] && [ -n "$NEZHA_KEY" ]; then\n\
    nezha-agent -s $NEZHA_SERVER -p $NEZHA_KEY &\n\
fi\n\
node index.js' > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
